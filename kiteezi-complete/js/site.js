(function(){
  const C=window.KITEEZI_CONFIG||{};
  const url=(C.SUPABASE_URL||'').replace(/\/$/,'');
  const key=C.SUPABASE_ANON_KEY||'';
  const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
  const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  const api=async(path,opt={})=>{const r=await fetch(url+'/rest/v1/'+path,{...opt,headers:{...headers,...(opt.headers||{})}});const text=await r.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}if(!r.ok)throw new Error(data?.message||data?.hint||data?.details||text||('HTTP '+r.status));return data};
  window.Kiteezi={api,esc};

  const year=new Date().getFullYear();$$('[data-year]').forEach(e=>e.textContent=year);
  const path=location.pathname.split('/').pop()||'index.html';$$('.links a').forEach(a=>{if((a.getAttribute('href')||'').split('?')[0]===path)a.classList.add('active')});
  const menuBtn=$('[data-mobile]');if(menuBtn)menuBtn.onclick=()=>$('.links')?.classList.toggle('mobile-open');
  // Never expose a staff/admin portal link on the public website.
  $$('a[href*="admin/"]').forEach(a=>a.remove());

  const contact=$('[data-contact-form]');
  if(contact) contact.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(contact);const text=`Kiteezi website enquiry\nName: ${fd.get('name')||''}\nPhone: ${fd.get('phone')||''}\nEmail: ${fd.get('email')||''}\nMessage: ${fd.get('message')||''}`;const box=$('[data-form-message]',contact);if(box){box.textContent='Opening WhatsApp to send your enquiry to Kiteezi reception.';box.hidden=false;}window.open('https://wa.me/'+(C.WHATSAPP||'256709763803')+'?text='+encodeURIComponent(text),'_blank');});

  const form=$('[data-booking-form]');
  if(form) initBooking(form);

  async function initBooking(form){
    const serviceSelect=$('[name="service"]',form), foodBox=$('[data-catering]',form), menuBox=$('[data-menu-options]',form), totalBox=$('[data-food-total]',form), payBox=$('[data-payment]',form);
    const params=new URLSearchParams(location.search), requested=params.get('service');
    const known={
      'school-swimming':'School Swimming','training':'Swimming Training','event':'Event & Catering','basketball':'Basketball','football':'Football'
    };
    try{
      const services=await api('services?select=id,name,category,description,price,duration_minutes&active=eq.true&order=category,name');
      if(Array.isArray(services)&&services.length){
        const existing=services.map(s=>s.name.toLowerCase());
        const extra=[{id:'virtual-basketball',name:'Basketball',category:'sports',price:0},{id:'virtual-football',name:'Football',category:'sports',price:0}].filter(x=>!existing.includes(x.name.toLowerCase()));
        serviceSelect.innerHTML=services.concat(extra).map(s=>`<option value="${esc(s.id)}" data-name="${esc(s.name)}" data-category="${esc(s.category||'')}" data-price="${Number(s.price||0)}">${esc(s.name)}</option>`).join('');
        if(requested&&known[requested]){const hit=services.concat(extra).find(s=>s.name.toLowerCase()===known[requested].toLowerCase());if(hit)serviceSelect.value=hit.id;}
      }else throw new Error('No services returned');
    }catch(e){
      const fallback=[['Public Swimming','swimming'],['School Swimming','swimming'],['Swimming Training','swimming'],['Basketball','sports'],['Football','sports'],['Restaurant / Dining','restaurant'],['Event & Catering','events'],['Other','other']];
      serviceSelect.innerHTML=fallback.map(([n,c])=>`<option value="${esc(n)}" data-name="${esc(n)}" data-category="${c}" data-price="0">${esc(n)}</option>`).join('');
      if(requested&&known[requested])serviceSelect.value=known[requested];
    }
    let menu=[];
    try{menu=await api('menu_items?select=id,name,price,description,in_stock,category_id&in_stock=eq.true&order=name');}catch(e){menu=[];}
    const isSportOrSwim=()=>{const o=serviceSelect.selectedOptions[0];const c=(o?.dataset.category||'').toLowerCase();const n=(o?.dataset.name||o?.textContent||'').toLowerCase();return c==='swimming'||c==='sports'||n.includes('swimming')||n.includes('basketball')||n.includes('football');};
    const renderMenu=()=>{
      if(!foodBox)return;const show=!isSportOrSwim();foodBox.hidden=!show;const agreement=$('[name="catering_agreement"]',form);if(agreement)agreement.required=show;
      if(payBox)payBox.hidden=false;
      if(!show)return;
      if(menuBox){menuBox.innerHTML=menu.length?menu.map(i=>`<div class="menu-choice"><label><span><strong>${esc(i.name)}</strong><small>${esc(i.description||'')}</small></span><span>UGX ${Number(i.price||0).toLocaleString()} <input type="number" min="0" step="1" value="0" name="food_${esc(i.id)}" data-price="${Number(i.price||0)}" data-menu-id="${esc(i.id)}" style="width:85px"></span></label></div>`).join(''):'<p class="notice">Food and drink choices will be loaded from the live menu. Reception can also add catering items manually.</p>';}
      calc();
    };
    const calc=()=>{let total=0;$$('input[data-menu-id]',form).forEach(i=>total+=Number(i.value||0)*Number(i.dataset.price||0));if(totalBox)totalBox.textContent='UGX '+total.toLocaleString();};
    serviceSelect.addEventListener('change',renderMenu);form.addEventListener('input',calc);renderMenu();

    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const btn=form.querySelector('button[type="submit"]'),msg=$('[data-form-message]',form);if(btn){btn.disabled=true;btn.textContent='Sending…';}if(msg)msg.hidden=true;
      try{
        const fd=new FormData(form), option=serviceSelect.selectedOptions[0];
        const name=String(fd.get('name')||'').trim(),phone=String(fd.get('phone')||'').trim(),email=String(fd.get('email')||'').trim();
        if(!name||!phone)throw new Error('Please provide your name and phone number.');
        const date=String(fd.get('date')||'');if(!date)throw new Error('Please select a date.');
        const people=Math.max(1,Number(fd.get('people')||1));
        // Prevent an obvious duplicate request for the same service/date/time.
        // This is only a client-side guard; reception/admin confirmation remains authoritative.
        const time=String(fd.get('time')||'');
        const conflictRows=await api(`bookings?select=id,service_id,start_time,status,notes&booking_date=eq.${encodeURIComponent(date)}&status=not.in.(cancelled,completed)&limit=500`);
        const requestedName=String(option.dataset.name||option.textContent||'').trim().toLowerCase();
        const duplicate=conflictRows.some(b=>{
          if(!time || b.start_time!==time) return false;
          if(option.value && /^[0-9a-f-]{20,}$/i.test(option.value)) return b.service_id===option.value;
          try{return JSON.parse(b.notes||'{}').requested_service?.toLowerCase()===requestedName;}catch{return false;}
        });
        if(duplicate) throw new Error('That service already has a booking request at the selected date and time. Please choose another time or contact reception.');
        let customers=await api(`customers?select=id&phone=eq.${encodeURIComponent(phone)}&limit=1`);
        let customerId=customers?.[0]?.id;
        if(!customerId){const created=await api('customers',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({name,phone,email:email||null})});customerId=created?.[0]?.id;}
        if(!customerId)throw new Error('Customer record could not be created. Check Supabase RLS for customers.');
        let serviceId=option.value;
        if(!/^[0-9a-f-]{20,}$/i.test(serviceId)){
          const sr=await api(`services?select=id,name&name=eq.${encodeURIComponent(option.dataset.name||option.textContent)}&limit=1`);serviceId=sr?.[0]?.id||null;
        }
        const catering=[];if(!isSportOrSwim())$$('input[data-menu-id]',form).forEach(i=>{const q=Number(i.value||0);if(q>0)catering.push({menu_item_id:i.dataset.menuId,quantity:q,unit_price:Number(i.dataset.price||0)});});
        const cateringTotal=catering.reduce((s,i)=>s+i.quantity*i.unit_price,0);
        const payment=String(fd.get('payment_method')||'cash');
        const notes={requested_service:String(option.dataset.name||option.textContent||''),customer_notes:String(fd.get('notes')||''),catering_required:!isSportOrSwim(),outside_catering_allowed:false,catering_items:catering,catering_total:cateringTotal,payment_method:payment,payment_reference:String(fd.get('payment_reference')||''),payment_instructions:{cash:'Pay at reception.',airtel:`Airtel Money: ${C.AIR_TEL||'4371872'}`,mtn:`MTN Mobile Money: ${C.MTN||'716644'}`}};
        const booking={customer_id:customerId,service_id:serviceId||null,booking_date:date,start_time:time||null,people,source:'website',status:'pending',payment_status:'unpaid',total:cateringTotal,notes:JSON.stringify(notes)};
        const created=await api('bookings',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(booking)});
        if(!created?.length)throw new Error('Booking was not returned by Supabase.');
        if(msg){msg.className='notice';msg.textContent=`Booking request received. Reference: ${created[0].id}. Payment remains pending until Kiteezi verifies it.`;msg.hidden=false;}
        form.reset();renderMenu();
      }catch(err){if(msg){msg.className='notice error';msg.textContent='Booking could not be submitted: '+err.message;msg.hidden=false;}}
      finally{if(btn){btn.disabled=false;btn.textContent='Send booking request';}}
    },{once:true});
  }
})();
