'use strict';
/* Unified POS catalogue: restaurant menu items and immediate walk-in services share one order. */
(function(){
  const posAdminCanManage=()=>profile?.role==='owner'||hasPermission('orders.manage');
  const posRefreshCatalogue=async()=>{
    const [cats,items]=await Promise.all([
      api('/rest/v1/pos_categories?select=id,name,description,sort_order,active&active=eq.true&order=sort_order.asc,name.asc'),
      api('/rest/v1/pos_items?select=id,category_id,name,description,unit_price,price_on_request,is_available,fulfillment_mode,department_key,menu_item_id,img_url,alt_text,serving_unit,pricing_mode,team_threshold,small_group_price,full_team_price,serves_people,sort_order,active,pos_categories(name)&active=eq.true&is_available=eq.true&price_on_request=eq.false&order=sort_order.asc,name.asc')
    ]);
    posCategories=Array.isArray(cats)?cats:[];
    const categoryNames=new Map(posCategories.map(c=>[String(c.id),c.name]));
    posMenuItems=(Array.isArray(items)?items:[])
      .filter(x=>categoryNames.has(String(x.category_id)))
      .map(x=>({...x,price:Number(x.unit_price)||0,category:categoryNames.get(String(x.category_id))||x.pos_categories?.name||'Other'}));
    posMenuLoaded=true;
    if(posActiveCategory&&!posCategories.some(c=>String(c.id)===String(posActiveCategory)))posActiveCategory='';
    posRenderCategories();posRenderProducts();posRenderCart();
    const status=$('#posMenuStatus');
    if(status)status.textContent=posMenuItems.length+' POS items and services available';
  };
  /* Replace the menu-only loader; the existing order/payment flow still uses create_pos_order_v2
     and record_pos_payment, so service sales stay in ordinary orders rather than bookings. */
  loadPosMenu=async function(force=false){
    const shell=document.querySelector('.pos-shell');if(!shell)return;
    if(!hasPermission('orders.create')&&!hasPermission('orders.manage')){shell.hidden=true;return}
    shell.hidden=false;
    if(posMenuLoaded&&!force)return;
    try{await posRefreshCatalogue()}
    catch(e){posMenuLoaded=false;const el=$('#posMenuStatus');if(el)el.textContent='Unable to load the POS catalogue. Refresh and try again.';msg(e)}
  };
  function posCatalogManagerHtml(){
    const categoryOptions=posCategories.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
    return '<div class="panel"><h3>Add POS category</h3><form id="posAddCategoryForm" class="form"><label>Category name<input name="name" maxlength="80" required placeholder="e.g. Board Games"></label><label>Description (optional)<textarea name="description" maxlength="300" rows="2"></textarea></label><button class="btn btn-dark" type="submit">Add category</button></form></div>'+
      '<div class="panel"><h3>Add walk-in service or activity</h3><p class="muted">Use this for services sold immediately at the venue. Future reservations still belong in Bookings. Food and drinks should continue to be maintained in Menu.</p><form id="posAddServiceForm" class="form">'+
      '<label>Service / activity name<input name="name" maxlength="120" required placeholder="e.g. Table tennis"></label>'+
      '<label>Category<select name="category_id" required>'+(categoryOptions||'<option value="">Create a category first</option>')+'</select></label>'+
      '<label>Description (optional)<textarea name="description" maxlength="500" rows="2"></textarea></label>'+
      '<label>Price (UGX)<input name="unit_price" type="number" min="1" step="1" required></label>'+
      '<label>Department<select name="department_key" required><option value="swimming">Swimming</option><option value="sports">Sports & games</option><option value="photography">Photography</option><option value="buffet">Buffet & events</option><option value="other">Other</option></select></label>'+
      '<label>Pricing style<select name="pricing_mode"><option value="fixed">Fixed price</option><option value="per_person">Per person</option><option value="fixed_package">Fixed package</option></select></label>'+
      '<button class="btn btn-dark" type="submit" '+(!posCategories.length?'disabled':'')+'>Add service to POS</button></form></div>'+
      '<div class="panel"><h3>Edit prices in New Order</h3><p class="muted">Change a price here without leaving Orders → New Order. Changes affect future orders; existing orders are not repriced.</p><div class="table-wrap"><table><thead><tr><th>Item / service</th><th>Category</th><th>Current price (UGX)</th><th>Save</th></tr></thead><tbody>'+posMenuItems.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.category)+'</td><td><form class="posEditPriceForm" data-pos-item-id="'+esc(x.id)+'" style="display:flex;gap:.5rem;align-items:center"><input name="unit_price" type="number" min="0" step="1" required value="'+esc(x.unit_price)+'" aria-label="Price for '+esc(x.name)+'" style="max-width:9rem"><button class="btn btn-dark" type="submit">Save price</button></form></td><td><span class="muted">UGX</span></td></tr>').join('')+'</tbody></table></div><div class="state">'+posMenuItems.length+' active items/services are available in this New Order catalogue.</div></div>';
  }
  async function posOpenCatalogManager(){
    if(!posAdminCanManage()){posSetStatus('You need orders.manage permission to manage POS categories and services.',true);return}
    try{await posRefreshCatalogue()}catch(e){msg(e);return}
    modal('Manage POS catalogue',posCatalogManagerHtml());
    const catForm=$('#posAddCategoryForm');
    if(catForm)catForm.onsubmit=async e=>{
      e.preventDefault();const f=new FormData(catForm),name=String(f.get('name')||'').trim();
      if(!name)return;
      const submit=catForm.querySelector('button[type=submit]');submit.disabled=true;
      try{
        const duplicate=posCategories.some(c=>c.name.toLowerCase()===name.toLowerCase());
        if(duplicate)throw Error('That POS category already exists.');
        await api('/rest/v1/pos_categories',{method:'POST',body:JSON.stringify({name,description:String(f.get('description')||'').trim()||null,sort_order:posCategories.reduce((m,c)=>Math.max(m,Number(c.sort_order)||0),0)+1,active:true})});
        await posRefreshCatalogue();posOpenCatalogManager();
      }catch(err){msg(err);submit.disabled=false}
    };
    const itemForm=$('#posAddServiceForm');
    if(itemForm)itemForm.onsubmit=async e=>{
      e.preventDefault();const f=new FormData(itemForm),name=String(f.get('name')||'').trim(),price=Number(f.get('unit_price'));
      if(!name||!f.get('category_id')||!Number.isFinite(price)||price<=0){msg(Error('Enter a name, category and price greater than zero.'));return}
      const submit=itemForm.querySelector('button[type=submit]');submit.disabled=true;
      try{
        await api('/rest/v1/pos_items',{method:'POST',body:JSON.stringify({
          category_id:String(f.get('category_id')),name,description:String(f.get('description')||'').trim()||null,
          unit_price:price,price_on_request:false,is_available:true,fulfillment_mode:'record_only',
          department_key:String(f.get('department_key')||'other'),menu_item_id:null,
          pricing_mode:String(f.get('pricing_mode')||'fixed'),team_threshold:null,
          small_group_price:null,full_team_price:null,serves_people:null,
          sort_order:posMenuItems.reduce((m,x)=>Math.max(m,Number(x.sort_order)||0),0)+1,active:true
        })});
        await posRefreshCatalogue();posSetStatus('Service added to the POS catalogue. It can now be added to a walk-in order.');posOpenCatalogManager();
      }catch(err){msg(err);submit.disabled=false}
    };
    document.querySelectorAll('.posEditPriceForm').forEach(priceForm=>{
      priceForm.onsubmit=async e=>{
        e.preventDefault();
        const itemId=priceForm.dataset.posItemId;
        const input=priceForm.querySelector('[name="unit_price"]');
        const price=Number(input?.value);
        if(!itemId||!Number.isFinite(price)||price<0){msg(Error('Enter a valid price of zero or more.'));return}
        const submit=priceForm.querySelector('button[type="submit"]');
        if(submit)submit.disabled=true;
        try{
          await api('/rest/v1/pos_items?id=eq.'+encodeURIComponent(itemId),{method:'PATCH',body:JSON.stringify({unit_price:price,updated_at:new Date().toISOString()})});
          await posRefreshCatalogue();
          posSetStatus('POS price updated. This applies to future orders; existing orders remain unchanged.');
          posOpenCatalogManager();
        }catch(err){msg(err);if(submit)submit.disabled=false}
      };
    });
  }
  const manageButton=$('#posManageCategories');
  const syncManageButton=()=>{if(manageButton){manageButton.textContent='Manage POS catalogue';manageButton.hidden=!!profile&&!posAdminCanManage();}};
  if(manageButton){
    syncManageButton();
    manageButton.addEventListener('click',()=>posOpenCatalogManager().catch(msg));
  }
  /* setupPos runs when the authenticated admin interface is initialized; sync visibility then. */
  const originalSetupPos=setupPos;
  setupPos=function(){originalSetupPos();syncManageButton();};
})();