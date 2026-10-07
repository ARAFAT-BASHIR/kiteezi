'use strict';
(function(){
  if(window.__KITEEZI_ADMIN_HARDENING__) return;
  window.__KITEEZI_ADMIN_HARDENING__=true;

  const C=window.KITEEZI_CONFIG||{};
  const URL=String(C.SUPABASE_URL||'').replace(/\/+$/,'');
  const KEY=String(C.SUPABASE_ANON_KEY||'');
  const session=()=>{try{return JSON.parse(sessionStorage.getItem('kiteezi_admin_session')||'null')}catch{return null}};
  const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const money=v=>new Intl.NumberFormat('en-UG').format(Number(v)||0);

  async function get(path){
    const s=session();
    const token=s?.access_token||KEY;
    const r=await fetch(URL+path,{headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'}});
    const t=await r.text(); let d; try{d=t?JSON.parse(t):null}catch{d=t}
    if(!r.ok) throw Error(window.humanAdminError ? window.humanAdminError(d?.message||d?.msg||d?.error_description||d?.error||'Request failed') : 'We could not load that information right now.');
    return Array.isArray(d)?d:[];
  }

  async function safeInventory(){
    const box=document.querySelector('#inventoryTable');
    if(!box)return;
    try{
      const rows=await get('/rest/v1/inventory_items?select=id,name,unit,category,active,station_id&active=eq.true&order=name.asc');
      const safe=Array.isArray(rows)?rows:[];
      if(!safe.length){box.innerHTML='<div class="state">No active inventory items.</div>';return safe;}
      box.innerHTML='<table><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th>Status</th></tr></thead><tbody>'+
        safe.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.category||'')+'</td><td>'+esc(x.unit||'')+'</td><td><span class="pill">Active</span></td></tr>').join('')+
        '</tbody></table>';
      return safe;
    }catch(e){
      console.error('Safe inventory loader failed',e);
      box.innerHTML='<div class="state danger">Inventory could not be loaded. Please check your inventory permission or Supabase connection.</div>';
      return [];
    }
  }

  function install(){
    if(typeof window.loadInventory==='function' && !window.loadInventory.__hardened){
      const original=window.loadInventory;
      const wrapped=async function(){
        try{
          const result=await original();
          return Array.isArray(result)?result:result;
        }catch(e){
          console.error('Primary inventory loader failed; using safe fallback.',e);
          return safeInventory();
        }
      };
      wrapped.__hardened=true;
      window.loadInventory=wrapped;
    }

    const refresh=document.querySelector('#refreshInventory');
    if(refresh)refresh.onclick=()=>window.loadInventory?.().catch(()=>safeInventory());

    document.querySelector('#inventorySubnav')?.addEventListener('click',e=>{
      const b=e.target.closest('[data-inv-tab]');
      if(!b)return;
      if(b.dataset.invTab==='items') setTimeout(()=>window.loadInventory?.().catch(()=>safeInventory()),0);
    });

    // Never allow a hash to expose a module the current role cannot access.
    if(typeof window.route==='function' && typeof window.canOpenTab==='function' && !window.route.__hardened){
      const originalRoute=window.route;
      const guarded=function(name){
        if(!name)name='dashboard';
        try{
          if(name!=='dashboard' && !window.canOpenTab(name)){
            history.replaceState(null,'','#dashboard');
            return originalRoute('dashboard');
          }
        }catch(e){ console.warn('Route permission guard:',e); }
        return originalRoute(name);
      };
      guarded.__hardened=true;
      window.route=guarded;
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});
  else install();
})();