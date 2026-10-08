'use strict';
const C=window.KITEEZI_CONFIG||{}, URL=String(C.SUPABASE_URL||'').replace(/\/+$/,''), KEY=String(C.SUPABASE_ANON_KEY||'');
let session=null,profile=null,tab='dashboard',permissions=new Set();
const SESSION_KEY='kiteezi_admin_session';
function readAdminSession(){try{const raw=localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY);return raw?JSON.parse(raw):null}catch{return null}}
function writeAdminSession(value){const raw=JSON.stringify(value);localStorage.setItem(SESSION_KEY,raw);sessionStorage.setItem(SESSION_KEY,raw)}
function clearAdminSession(){localStorage.removeItem(SESSION_KEY);sessionStorage.removeItem(SESSION_KEY)}
function setAuthView(authenticated){
  const loginView=$('#loginView'), app=$('#app');
  if(authenticated){
    if(loginView){loginView.classList.add('hide');loginView.hidden=true;loginView.setAttribute('aria-hidden','true');}
    if(app){app.classList.remove('hide');app.hidden=false;app.setAttribute('aria-hidden','false');}
    document.body.classList.add('authenticated-shell');
  }else{
    if(app){app.classList.add('hide');app.hidden=true;app.setAttribute('aria-hidden','true');}
    if(loginView){loginView.classList.remove('hide');loginView.hidden=false;loginView.setAttribute('aria-hidden','false');}
    document.body.classList.remove('authenticated-shell');
  }
}
const TAB_PERMISSIONS={
  dashboard:'dashboard.view', bookings:'bookings.manage', restaurant:'orders.manage',
  inventory:'inventory.operational', menu:'menu.manage', services:'services.manage',
  inquiries:'inquiries.view', swimming_timetable:'swimming.manage', swimming_sessions:'swimming.assigned', tasks:'tasks.manage', content:'content.manage', gallery:'gallery.view',
  reviews:'reviews.view', social:'social.manage', staff:'staff.manage',
  accounting:'reports.financial', settings:'site_settings.manage', requisitions:'requisitions.view', audit:'reports.view', assets:'reports.view', purchases:'purchase_orders.view', service_tally:'service_logs.create'
};
const TAB_FALLBACK_PERMISSIONS={
  bookings:['bookings.view'],
  inventory:['inventory.all','inventory.operational','inventory.kitchen','inventory.bar','inventory.cleaning','inventory.swimming','inventory.service'],
  restaurant:['orders.manage','orders.station_kitchen','orders.station_barista','orders.reception.view'],
  menu:['menu.manage','menu.view','menu.public_content.manage'],
  inquiries:['inquiries.view','inquiries.catering','inquiries.drinks','inquiries.general','inquiries.swimming'],
  swimming_sessions:['swimming.manage','swimming.assigned'],
  accounting:['reports.financial','reports.view'],
  staff:['staff.manage','roles.manage','staff.view']
};
const hasPermission=code=>profile?.role==='owner'||permissions.has(code);
const canSeeTab=name=>name==='settings' ? Boolean(profile?.active) : (profile?.role==='general_manager' ? true : hasPermission(TAB_PERMISSIONS[name])||(TAB_FALLBACK_PERMISSIONS[name]||[]).some(hasPermission));

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const setHTML=(s,v)=>{const el=$(s);if(el)el.innerHTML=v;};
const setText=(s,v)=>{const el=$(s);if(el)el.textContent=v;};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('en-UG').format(Number(v)||0);
function humanAdminError(error,fallback='We could not complete that action right now. Please try again.'){const m=String(error?.message??error??'').trim();if(!m||m==='[object Object]')return fallback;if(/(?:supabase|postgrest|pgrst|postgres|sql|schema|relation|column|constraint|permission denied|function .* does not exist|does not exist|http\s*\d{3}|\b(?:3f000|42883|42501|235\d{3})\b|fetch failed|network error|unexpected .* response|syntax error|jwt)/i.test(m)||/^\s*[\[{].*[\]}]\s*$/.test(m))return fallback;return m;}
async function api(path,opt={},token=session?.access_token||KEY){
  const request=async tk=>{
    const h={apikey:KEY,Authorization:'Bearer '+tk,'Content-Type':'application/json',...(opt.headers||{})};
    if(opt.method&&opt.method!=='GET')h.Prefer='return=representation';
    return fetch(URL+path,{...opt,headers:h});
  };
  let r=await request(token);
  if(r.status===401&&token!==KEY&&!opt.__authRetry&&typeof window.__KITEEZI_REFRESH_ADMIN_SESSION__==='function'){
    try{
      const refreshed=await window.__KITEEZI_REFRESH_ADMIN_SESSION__();
      if(refreshed?.access_token){
        session=refreshed;
        token=refreshed.access_token;
        const retryOpt={...opt,__authRetry:true};
        const h={apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json',...(retryOpt.headers||{})};
        if(retryOpt.method&&retryOpt.method!=='GET')h.Prefer='return=representation';
        r=await fetch(URL+path,{...retryOpt,headers:h});
      }
    }catch{}
  }
  const t=await r.text();let d;try{d=t?JSON.parse(t):null}catch{d=t}
  if(!r.ok){const error=Error(humanAdminError(d?.message||d?.msg||d?.error_description||d?.error||(typeof d==='string'?d:'Request failed')));error.status=r.status;error.auth=r.status===401;throw error}
  return d;
}
function msg(e){console.error(e);alert(humanAdminError(e,'We could not complete that action right now. Please try again.'))}
// Login is handled exclusively by admin-login.js to avoid duplicate submit handlers. 
async function loadStations(){return api('/rest/v1/service_stations?select=id,name,description,active,sort_order&order=sort_order.asc,name.asc')}
let UNIT_OPTIONS=[];
async function loadUnitOptions(){if(UNIT_OPTIONS.length)return UNIT_OPTIONS;const rows=await api('/rest/v1/unit_options?select=code,label,category&active=eq.true&order=sort_order.asc,label.asc');UNIT_OPTIONS=Array.isArray(rows)?rows:[];return UNIT_OPTIONS}
function unitOptionsHtml(selected=''){const v=String(selected||'').toLowerCase();return '<option value="">Choose unit</option>'+UNIT_OPTIONS.map(u=>'<option value="'+esc(u.code)+'" '+(u.code===v?'selected':'')+'>'+esc(u.label)+'</option>').join('')}
async function bootAdmin(authSession){
  try{
    session=authSession||JSON.parse(sessionStorage.getItem('kiteezi_admin_session')||'null');
    if(!session?.access_token||!session?.user?.id)throw Error('No valid admin session.');
    writeAdminSession(session);
    const p=await api('/rest/v1/profiles?select=*&id=eq.'+encodeURIComponent(session.user.id)+'&limit=1');
    profile=p?.[0];
    if(!profile?.active)throw Error('This Kiteezi staff profile is inactive.');
    try{await show()}catch(e){
      console.error('Kiteezi admin display initialization error:',e);
      setAuthView(true);
      if($('#who'))$('#who').textContent=(profile.full_name||'Staff')+' · '+(profile.role||'staff');
      if($('#rolePill'))$('#rolePill').textContent=profile.role||'staff';
      const dash=$('#dashboard'); if(dash)dash.classList.add('active');
      document.querySelectorAll('.tab').forEach(x=>{if(x.id!=='dashboard')x.classList.remove('active')});
      if($('#todayOps'))$('#todayOps').textContent='Dashboard opened. Some live data could not be loaded yet.';
    }
    return true;
  }catch(e){
    console.error('Kiteezi admin boot failed:',e);
    const authFailure=!session?.user?.id||e?.auth||e?.status===401;
    if(authFailure){
      session=null;
      clearAdminSession();
    }
    setAuthView(false);
    const el=$('#loginMsg'); if(el){el.hidden=false;el.textContent=humanAdminError(e,'Unable to open the admin dashboard.');el.className='notice danger'}
    return false;
  }
}
window.KITEEZI_ADMIN_BOOT=bootAdmin;
async function restore(){
  const raw=localStorage.getItem(SESSION_KEY)||sessionStorage.getItem(SESSION_KEY);
  if(!raw){setAuthView(false);return}
  let saved;try{saved=JSON.parse(raw)}catch{saved=null}
  if(!saved?.access_token){clearAdminSession();setAuthView(false);return}
  try{
    const refresh=window.__KITEEZI_REFRESH_ADMIN_SESSION__;
    if(typeof refresh==='function'){
      const fresh=await refresh();
      if(fresh?.access_token)saved=fresh;
    }
  }catch{}
  await bootAdmin(saved);
}
async function loadAdminLogo(){try{const r=await api('/rest/v1/site_settings?select=value&key=eq.logo_url&limit=1');const v=r?.[0]?.value||'';document.querySelectorAll('.brand-mark').forEach(el=>{if(!v){el.textContent='K';return;}const img=document.createElement('img');img.src=v.startsWith('http')?v:'../'+v.replace(/^\/+/, '');img.alt='Kiteezi Recreational Center';img.loading='eager';el.textContent='';el.appendChild(img);});const p=$('#logoPreview');if(p){p.src=v?(v.startsWith('http')?v:'../'+v.replace(/^\/+/,'')):'';p.hidden=!v;}}catch{}}
function ensureAssetsTab(){
  if($('#assets'))return;
  const app=$('.main');if(!app)return;
  const sec=document.createElement('section');sec.id='assets';sec.className='tab';sec.hidden=true;sec.setAttribute('aria-hidden','true');
  sec.innerHTML='<div class="section-head"><div><h2>Assets</h2><p class="muted">Track purchase cost, current value, appreciation, depreciation, availability, damage and loss.</p></div><div class="toolbar"><button class="btn" id="newAsset">Add asset</button><button class="btn" id="exportAssets">Download CSV</button><button class="btn" id="printAssets">Print / Save PDF</button><button class="btn btn-dark" id="refreshAssets">Refresh</button></div></div><div id="assetsSummary" class="report-metrics"></div><div id="assetsTable" class="table-scroll"></div>';
  app.appendChild(sec);
  $('#refreshAssets').onclick=()=>loadAssets().catch(msg);$('#exportAssets').onclick=()=>exportOperationalTable('assetsTable','Kiteezi Assets Report');$('#printAssets').onclick=()=>printOperationalPanel('assets','Kiteezi Assets Report');
  $('#newAsset').onclick=()=>editAsset().catch(msg);
}
async function loadAssets(){
  const rows=await api('/rest/v1/assets?select=*&order=name.asc');
  const gmReadOnly=profile?.role==='general_manager',canEdit=profile?.role==='owner'||profile?.role==='manager';
  const add=$('#newAsset');if(add)add.hidden=!canEdit;
  const totalCost=rows.reduce((n,x)=>n+Number(x.acquisition_cost||0),0),totalValue=rows.reduce((n,x)=>n+Number(x.current_value||0),0),totalDep=rows.reduce((n,x)=>n+Number(x.accumulated_depreciation||0),0),totalApp=rows.reduce((n,x)=>n+Number(x.appreciation_value||0),0);if($('#assetsSummary'))$('#assetsSummary').innerHTML='<div class="metric"><b>UGX '+money(totalCost)+'</b>Purchase cost</div><div class="metric"><b>UGX '+money(totalValue)+'</b>Current value</div><div class="metric"><b>UGX '+money(totalDep)+'</b>Depreciation</div><div class="metric"><b>UGX '+money(totalApp)+'</b>Appreciation</div>';  $('#assetsTable').innerHTML=rows.length?'<table><tr><th>Asset</th><th>Department</th><th>Purchase cost</th><th>Current value</th><th>Depreciation</th><th>Appreciation</th><th>Available</th><th>Damaged</th><th>Lost</th><th>Status</th><th></th></tr>'+rows.map(x=>'<tr><td>'+esc(x.asset_code)+'<br>'+esc(x.name)+'</td><td>'+esc(x.department||'')+'</td><td>UGX '+money(x.acquisition_cost)+'</td><td>UGX '+money(x.current_value)+'</td><td>UGX '+money(x.accumulated_depreciation)+'</td><td>UGX '+money(x.appreciation_value)+'</td><td>'+esc(x.quantity_available)+'</td><td>'+esc(x.damaged_quantity)+'</td><td>'+esc(x.lost_quantity)+'</td><td>'+esc(x.status)+'</td><td>'+(canEdit&&!gmReadOnly?'<button class="btn" data-edit-asset="'+x.id+'">Edit</button>':'View only')+'</td></tr>').join('')+'</table>':'<div class="state">No assets recorded.</div>';
  document.querySelectorAll('[data-edit-asset]').forEach(b=>b.onclick=()=>editAsset(b.dataset.editAsset).catch(msg));
}
async function editAsset(id=null){
  const x=id?(await api('/rest/v1/assets?id=eq.'+encodeURIComponent(id)))[0]:{asset_code:'',name:'',category:'',acquisition_date:today(),acquisition_cost:0,accumulated_depreciation:0,current_value:0,appreciation_value:0,quantity_available:1,damaged_quantity:0,lost_quantity:0,status:'active',department:'',notes:''};
  if(!x)throw Error('Asset not found.');
  const body=(f)=>({asset_code:String(f.get('asset_code')||'').trim(),name:String(f.get('name')||'').trim(),category:f.get('category')||null,acquisition_date:f.get('acquisition_date')||null,acquisition_cost:Number(f.get('acquisition_cost')||0),accumulated_depreciation:Number(f.get('accumulated_depreciation')||0),current_value:Number(f.get('current_value')||0),appreciation_value:Number(f.get('appreciation_value')||0),quantity_available:Number(f.get('quantity_available')||0),damaged_quantity:Number(f.get('damaged_quantity')||0),lost_quantity:Number(f.get('lost_quantity')||0),status:f.get('status')||'active',department:f.get('department')||null,notes:f.get('notes')||null});
  modal(id?'Edit asset':'Add asset','<form id="assetForm" class="form"><input name="asset_code" value="'+esc(x.asset_code)+'" placeholder="Asset code" required><input name="name" value="'+esc(x.name)+'" placeholder="Asset name" required><input name="category" value="'+esc(x.category||'')+'" placeholder="Category"><input name="department" value="'+esc(x.department||'')+'" placeholder="Department"><input name="acquisition_date" type="date" value="'+esc(x.acquisition_date||today())+'"><input name="acquisition_cost" type="number" step="0.01" min="0" value="'+Number(x.acquisition_cost||0)+'" placeholder="Purchase price"><input name="current_value" type="number" step="0.01" min="0" value="'+Number(x.current_value||0)+'" placeholder="Current value"><input name="accumulated_depreciation" type="number" step="0.01" min="0" value="'+Number(x.accumulated_depreciation||0)+'" placeholder="Accumulated depreciation"><input name="appreciation_value" type="number" step="0.01" min="0" value="'+Number(x.appreciation_value||0)+'" placeholder="Appreciation"><input name="quantity_available" type="number" min="0" value="'+Number(x.quantity_available||0)+'" placeholder="Available quantity"><input name="damaged_quantity" type="number" min="0" value="'+Number(x.damaged_quantity||0)+'" placeholder="Damaged quantity"><input name="lost_quantity" type="number" min="0" value="'+Number(x.lost_quantity||0)+'" placeholder="Lost quantity"><select name="status"><option '+(x.status==='active'?'selected':'')+'>active</option><option '+(x.status==='maintenance'?'selected':'')+'>maintenance</option><option '+(x.status==='disposed'?'selected':'')+'>disposed</option><option '+(x.status==='lost'?'selected':'')+'>lost</option></select><textarea name="notes" placeholder="Notes">'+esc(x.notes||'')+'</textarea><button class="btn btn-dark">Save asset</button></form>');
  $('#assetForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const payload=body(f);if(!payload.asset_code||!payload.name)return;await api(id?'/rest/v1/assets?id=eq.'+encodeURIComponent(id):'/rest/v1/assets',{method:id?'PATCH':'POST',body:JSON.stringify(payload)});closeModal();await loadAssets()};
}
function ensureAuditTab(){
  if($('#audit'))return;
  const app=$('.main');
  if(!app)return;
  const sec=document.createElement('section');
  sec.id='audit';sec.className='tab';sec.hidden=true;sec.setAttribute('aria-hidden','true');
  sec.innerHTML='<div class="section-head"><div><h2>Audit Trail</h2><p class="muted">Filter operational history by date range. Audit deletion is restricted to the Owner.</p></div><div class="toolbar"><input id="auditFrom" type="date"><input id="auditTo" type="date"><button class="btn" id="exportAudit">Download CSV</button><button class="btn" id="printAudit">Print / Save PDF</button><button class="btn btn-dark" id="refreshAudit">Refresh</button></div></div><div id="auditSummary" class="report-metrics"></div><div id="auditTable" class="table-scroll"></div>';
  app.appendChild(sec);
  $('#refreshAudit').onclick=()=>loadAuditTrail().catch(msg);$('#exportAudit').onclick=()=>exportOperationalTable('auditTable','Kiteezi Audit Trail');$('#printAudit').onclick=()=>printOperationalPanel('audit','Kiteezi Audit Trail');
}
async function loadAuditTrail(){
  const box=$('#auditTable');if(!box)return;
  const from=$('#auditFrom')?.value||'',to=$('#auditTo')?.value||'';
  let q='/rest/v1/audit_logs?select=id,action,entity_type,entity_id,actor_name,actor_role,actor_department,details,occurred_from,occurred_to&order=occurred_from.desc&limit=500';
  if(from)q+='&occurred_from=gte.'+encodeURIComponent(from+'T00:00:00+03:00');
  if(to)q+='&occurred_to=lte.'+encodeURIComponent(to+'T23:59:59+03:00');
  const rows=await api(q);
  const counts={entries:rows.length,actors:new Set(rows.map(x=>x.actor_name||x.actor_id).filter(Boolean)).size,actions:new Set(rows.map(x=>x.action).filter(Boolean)).size};if($('#auditSummary'))$('#auditSummary').innerHTML='<div class="metric"><b>'+counts.entries+'</b>Entries</div><div class="metric"><b>'+counts.actors+'</b>Actors</div><div class="metric"><b>'+counts.actions+'</b>Action types</div>';  box.innerHTML=rows.length?'<table><tr><th>From</th><th>To</th><th>Actor</th><th>Role</th><th>Department</th><th>Action</th><th>Entity</th><th>Details</th>'+(profile?.role==='owner'?'<th>Owner</th>':'')+'</tr>'+rows.map(x=>'<tr><td>'+esc(x.occurred_from||'')+'</td><td>'+esc(x.occurred_to||'')+'</td><td>'+esc(x.actor_name||x.actor_id||'')+'</td><td>'+esc(x.actor_role||'')+'</td><td>'+esc(x.actor_department||'')+'</td><td>'+esc(x.action||'')+'</td><td>'+esc(x.entity_type||'')+'</td><td>'+esc(JSON.stringify(x.details||{}))+'</td>'+(profile?.role==='owner'?'<td><button class="btn btn-danger audit-delete" data-id="'+esc(x.id)+'">Delete</button></td>':'')+'</tr>').join('')+'</table>':'<div class="state">No audit entries in this date range.</div>';
  if(profile?.role==='owner')document.querySelectorAll('.audit-delete').forEach(btn=>btn.onclick=async()=>{if(!confirm('Permanently delete this audit record? This cannot be undone.'))return;try{await api('/rest/v1/audit_logs?id=eq.'+encodeURIComponent(btn.dataset.id),{method:'DELETE'});await loadAuditTrail();showAdminToast('Deleted','Audit record deleted.')}catch(e){msg(e)}});
}
async function show(){
  setAuthView(true);ensureAuditTab();ensureAssetsTab();if($('#who'))$('#who').textContent=(profile?.full_name||'Staff')+' · '+(profile?.role||'staff');
  if($('#rolePill'))$('#rolePill').textContent=profile?.role||'staff';
  try{loadAdminLogo()}catch(e){console.warn('Admin logo load failed',e)}
  try{loadNotifications().catch(()=>{});startNotificationPolling()}catch(e){console.warn('Admin notifications unavailable',e)}
  try{loadPushSettings()}catch(e){console.warn('Push notification status unavailable',e)}
  try{const sendButton=$('#sendStaffNotification');if(sendButton)sendButton.hidden=!canSendStaffNotifications()}catch(e){console.warn('Notification sender visibility setup failed',e)}
  /*
    Load permissions and the first dashboard data at the same time.
    The dashboard used to wait for the permission queries to finish before
    its database reads even started.
  */
  const permissionsPromise = loadPermissions().catch(e => {
    console.warn('Admin permissions load failed',e);
    permissions=new Set();
  });
  const dashboardPromise = loadDashboard().catch(e => {
    console.warn('Admin dashboard data unavailable',e);
    if($('#todayOps'))$('#todayOps').textContent='Dashboard opened. Live data is still loading.';
  });

  try{await permissionsPromise;applyRoleNavigation()}catch(e){console.warn('Admin navigation setup failed',e)}
  try{
    await dashboardPromise;
    loadedTabs.add('dashboard');
    history.replaceState(null,'',location.search+'#dashboard');
    document.querySelectorAll('[data-tab]').forEach(a=>a.classList.toggle('active',a.dataset.tab==='dashboard'));
    document.querySelectorAll('.tab').forEach(sec=>{
      const active=sec.id==='dashboard';
      sec.classList.toggle('active',active);
      sec.hidden=!active;
      sec.setAttribute('aria-hidden',active?'false':'true');
    });
  }catch(e){
    console.error('Admin route initialization failed:',e);
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    $('#dashboard')?.classList.add('active');
    if($('#todayOps'))$('#todayOps').textContent='Dashboard opened. Live data is still loading.';
  }
  try{await consumePendingNotification()}catch(e){console.warn('Pending notification route failed:',e)}
}
async function loadPermissions(){
  permissions=new Set();
  if(profile?.role==='owner') return;
  const roleRows=await api('/rest/v1/roles?select=id&name=eq.'+encodeURIComponent(profile.role)+'&limit=1');
  const roleId=roleRows?.[0]?.id;
  if(!roleId) return;
  const rows=await api('/rest/v1/role_permissions?select=permissions(code)&role_id=eq.'+encodeURIComponent(roleId));
  rows.forEach(x=>{const code=x?.permissions?.code;if(code)permissions.add(code);});
}
function applyRoleNavigation(){
  const nav=$('#nav');
  const modules=[
    ['dashboard','Dashboard',['dashboard.view']],
    ['restaurant','Orders',['orders.view','orders.manage','orders.create','orders.station_kitchen','orders.station_barista','orders.reception.view']],
    ['bookings','Bookings',['bookings.view','bookings.manage']],
    ['inventory','Inventory',['inventory.view','inventory.all','inventory.operational','inventory.manage','inventory.kitchen','inventory.bar','inventory.cleaning','inventory.swimming','inventory.count','inventory.adjust']],
    ['menu','Menu',['menu.view','menu.manage','menu.public_content.manage']],
    ['services','Services',['services.manage']],
    ['inquiries','Inquiries',['inquiries.view','inquiries.catering','inquiries.drinks','inquiries.general','inquiries.swimming']],
    ['swimming_timetable','Swimming Timetable',['swimming.manage']],
    ['swimming_sessions','Swimming Sessions',['swimming.assigned','swimming.manage']],
    ['tasks','Grounds / Tasks',['tasks.manage']],
    ['content','Content / Media',['content.manage']],
    ['gallery','Gallery',['gallery.view','gallery.moderate','gallery.manage','gallery.upload']],
    ['reviews','Reviews',['reviews.view','reviews.moderate']],
    ['social','Social Links',['social.manage']],
    ['staff','Staff / Roles',['staff.manage','roles.manage','staff.view']],['customers','Customers',[]],
    ['accounting','Accounting & Finance',['reports.financial','reports.view','reports.inventory.view']],
    ['requisitions','Requisitions',['requisitions.view','requisitions.create','requisitions.approve.manager','requisitions.approve.gm','requisitions.approve.ceo','requisitions.approve.finance']],
    ['purchases','Purchase Orders',['purchase_orders.view','purchase_orders.manage','purchase_orders.create','purchase_orders.receive']],
    ['service_tally','Service Tally',['service_logs.create']],['assets','Assets',['reports.view','reports.financial']],
    ['settings','Settings',['site_settings.manage']],['audit','Audit Trail',['reports.view']],
  ];
  const visibleIds=new Set(modules.filter(([,label,needed])=>needed.length?needed.some(hasPermission):false).map(([id])=>id));if(profile?.active)visibleIds.add('settings');if(profile?.role==='owner')visibleIds.add('customers');
  if(nav){
    const groups=[
      ['OPERATIONS','operations',[['restaurant','Orders'],['bookings','Bookings'],['services','Sports & Services'],['swimming_timetable','Swimming Timetable'],['swimming_sessions','Swimming Sessions'],['tasks','Grounds / Tasks'],['inquiries','Customer Inquiries']]],
      ['ADMINISTRATION','administration',[['dashboard','Dashboard']]],
      ['WEBSITE','website',[['content','Website Content'],['social','Social Links'],['reviews','Public Reviews']]],
      ['MEDIA','media',[['gallery','Media / Gallery']]],
      ['MANAGEMENT','management',[['inventory','Inventory'],['requisitions','Requisitions'],['purchases','Purchase Orders'],['service_tally','Service Tally'],['assets','Assets'],['menu','Menu & Recipes']]],
      ['ACCOUNTING & REPORTS','finance',[['accounting','Accounting & Finance'],['audit','Audit Trail']]],
      ['HUMAN RESOURCES','hr',[['staff','Staff, Roles & Positions'],['customers','Customers']]],
      ['SETTINGS','settings',[['settings','Settings']]]
    ];
    nav.innerHTML=groups.map(([title,key,items])=>{
      const visible=items.filter(([id])=>visibleIds.has(id));
      if(!visible.length)return '';
      return '<div class="nav-group" data-nav-category="'+key+'"><div class="nav-group-title">'+title+'</div>'+
        visible.map(([id,label])=>'<a href="#'+id+'" data-tab="'+id+'">'+label+'</a>').join('')+
      '</div>';
    }).join('');
    const picker=$('#navCategory');
    const filterNav=()=>{
      const value=picker?.value||'all';
      $$('.nav-group',nav).forEach(g=>g.hidden=!(value==='all'||g.dataset.navCategory===value));
    };
    if(picker&&!picker.dataset.bound){
      picker.dataset.bound='1';
      picker.addEventListener('change',filterNav);
    }
    if(picker) filterNav();
  }
  // Hide entire module panels, not just their navigation links.
  document.querySelectorAll('.tab[id]').forEach(sec=>{
    const allowed=visibleIds.has(sec.id);
    sec.hidden=!allowed;
    sec.setAttribute('aria-hidden',allowed?'false':'true');
    if(!allowed)sec.classList.remove('active');
  });

  const canManageBusinessSettings=hasPermission('site_settings.manage');
  document.querySelectorAll('.business-settings-only').forEach(el=>{el.hidden=!canManageBusinessSettings;});
  const refreshSettings=$('#refreshSettings'); if(refreshSettings)refreshSettings.hidden=!canManageBusinessSettings;
  const saveSettingsButton=$('#saveSettings'); if(saveSettingsButton)saveSettingsButton.hidden=!canManageBusinessSettings;
  const settingsHeader=$('#settingsBusinessHeader'); if(settingsHeader)settingsHeader.hidden=!canManageBusinessSettings;
  const staffHelp=$('#staffHelp'); if(staffHelp&&!hasPermission('staff.manage'))staffHelp.textContent='Staff accounts are managed by the owner or authorized managers.';
  const newMenu=$('#newMenu'); if(newMenu)newMenu.hidden=!hasPermission('menu.manage');
  const newReq=$('#newRequisition'); if(newReq)newReq.hidden=!hasPermission('requisitions.create');
  const newOrder=$('#newOrder'); if(newOrder)newOrder.hidden=!(hasPermission('orders.create')||hasPermission('orders.manage'));
  const newInv=$('#newInventoryItem'); if(newInv)newInv.hidden=!hasPermission('inventory.manage');
  const newTask=$('#newTask'); if(newTask)newTask.hidden=!hasPermission('tasks.manage');
  const newServiceLogBtn=$('#newServiceLog'); if(newServiceLogBtn)newServiceLogBtn.hidden=!hasPermission('service_logs.create');

  const actionPermissions={
    newOrder:'orders.create',newInventoryItem:'inventory.manage',newTask:'tasks.manage',
    newSwimmingSlot:'swimming.manage',newMedia:'content.manage',newAnnouncement:'content.manage',
    newSocial:'social.manage',newStaff:'staff.manage',newTeamPosition:'site_settings.manage',
    newService:'services.manage',newSport:'sports.manage',newRequisition:'requisitions.create',
    newServiceLog:'service_logs.create',newGalleryMedia:'gallery.upload',saveSettings:'site_settings.manage'
  };
  Object.entries(actionPermissions).forEach(([id,perm])=>{
    const el=$('#'+id);
    if(el)el.hidden=!hasPermission(perm);
  });

  // Inventory sub-sections are independently permissioned.
  const invTabs={
    items:['inventory.view','inventory.all','inventory.operational','inventory.manage','inventory.kitchen','inventory.bar','inventory.cleaning','inventory.swimming','inventory.service'],
    daily:['inventory.count','inventory.manage'],
    purchases:['purchase_orders.view','purchase_orders.manage','purchase_orders.receive','purchase_orders.create'],
    movements:['inventory.adjust','inventory.manage'],
    recipes:['recipes.view','recipes.manage']
  };
  Object.entries(invTabs).forEach(([key,needed])=>{
    const b=document.querySelector('[data-inv-tab="'+key+'"]');
    if(b)b.hidden=!needed.some(hasPermission);
  });

  const dailyActions={
    setOpeningStock:hasPermission('inventory.manage'),
    countStock:hasPermission('inventory.count'),
    newStockAdjustment:hasPermission('inventory.adjust')||hasPermission('inventory.manage')
  };
  Object.entries(dailyActions).forEach(([id,allowed])=>{const el=$('#'+id);if(el)el.hidden=!allowed;});

  const recipeAdd=$('#newRecipe');
  if(recipeAdd)recipeAdd.hidden=!hasPermission('recipes.manage');

  const purchaseSubnav=document.querySelector('[data-inv-tab="purchases"]');
  if(purchaseSubnav)purchaseSubnav.hidden=!['purchase_orders.view','purchase_orders.manage','purchase_orders.receive','purchase_orders.create'].some(hasPermission);

  // Never leave a user sitting on a hidden module after permissions refresh.
  if(tab && !visibleIds.has(tab)){
    const fallback=visibleIds.has('dashboard')?'dashboard':modules.map(x=>x[0]).find(id=>visibleIds.has(id));
    if(fallback) route(fallback);
  }
}
function canOpenTab(name){return canSeeTab(name);}
function inquiryTypesForRole(){
  if(['owner','manager','ceo','general_manager','reception_manager'].includes(profile?.role)) return null;
  if(profile?.role==='head_swimming_coach'||profile?.role==='swimming_coach') return ['coaching','swimming'];
  if(profile?.role==='chef') return ['chef','catering','food'];
  if(profile?.role==='barista') return ['drinks','barista','beverages'];
  return [];
}
async function loadSwimmingSessions(){
  const rows=await api('/rest/v1/swimming_sessions?select=id,booking_id,session_type,school_name,coach_id,attendance_count,notes,created_at&order=created_at.desc');
  const canManage=hasPermission('swimming.manage');
  const coaches=canManage?await api('/rest/v1/profiles?select=id,full_name,role,active&active=eq.true&role=eq.swimming_coach&order=full_name.asc'):[];
  const coachNames=Object.fromEntries((coaches||[]).map(p=>[p.id,p.full_name||p.id]));
  $('#swimmingSessionsTable').innerHTML=rows.length
    ? '<table><tr><th>Session</th><th>Type</th><th>School</th><th>Coach</th><th>Attendance</th><th>Notes</th><th></th></tr>'+
      rows.map(x=>'<tr data-swimming-session-row="'+x.id+'"><td>'+esc(x.id.slice(0,8).toUpperCase())+'</td><td>'+esc(x.session_type||'')+'</td><td>'+esc(x.school_name||'')+'</td><td>'+esc(coachNames[x.coach_id]||x.coach_id||'Unassigned')+'</td><td>'+esc(x.attendance_count??0)+'</td><td>'+esc(x.notes||'')+'</td><td><button class="btn" data-edit-session="'+x.id+'">Update</button></td></tr>').join('')+'</table>'
    : '<div class="state">No assigned swimming sessions.</div>';
  $$('[data-edit-session]').forEach(b=>b.onclick=()=>editSwimmingSession(rows.find(x=>x.id===b.dataset.editSession),canManage,coaches));
}
async function editSwimmingSession(row,canManage,coaches=[]){
  if(!row)return;
  const coachOptions=canManage?'<label>Assign coach<select name="coach"><option value="">Unassigned</option>'+(coaches||[]).map(p=>'<option value="'+p.id+'" '+(p.id===row.coach_id?'selected':'')+'>'+esc(p.full_name||p.id)+'</option>').join('')+'</select></label>':'';
  modal('Swimming session','<form id="sessionForm" class="form">'+
    (canManage?'<label>Session type<input name="type" value="'+esc(row.session_type||'')+'" required></label><label>School / group<input name="school" value="'+esc(row.school_name||'')+'"></label>':'')+
    coachOptions+
    '<label>Attendance<input name="attendance" type="number" min="0" value="'+esc(row.attendance_count??0)+'"></label><label>Notes<textarea name="notes">'+esc(row.notes||'')+'</textarea></label><button class="btn btn-dark">Save</button></form>');
  $('#sessionForm').onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const body={attendance_count:Number(f.get('attendance')||0),notes:f.get('notes')||null};
    if(canManage){body.session_type=f.get('type');body.school_name=f.get('school')||null;body.coach_id=f.get('coach')||null;}
    try{await api('/rest/v1/swimming_sessions?id=eq.'+encodeURIComponent(row.id),{method:'PATCH',body:JSON.stringify(body)});closeModal();await loadSwimmingSessions();}catch(err){msg(err)}
  };
}

async function loadTasks(){
  const rows=await api('/rest/v1/staff_tasks?select=id,assigned_to,title,description,due_date,status,priority,rejection_reason,created_at&order=due_date.asc.nullsfirst,created_at.desc');
  const profiles=await api('/rest/v1/profiles?select=id,full_name,role,active&active=eq.true&order=full_name.asc');
  const names=Object.fromEntries((profiles||[]).map(p=>[p.id,p.full_name||p.id]));
  const canEdit=hasPermission('tasks.manage')||hasPermission('staff.manage');
  $('#tasksTable').innerHTML=rows.length
    ? '<table><tr><th>Task</th><th>Description</th><th>Priority</th><th>Due</th><th>Status</th><th>Assigned</th><th>Reason</th><th></th></tr>'+
      rows.map(x=>{const mine=x.assigned_to===profile?.id;return '<tr data-task-row="'+x.id+'"><td>'+esc(x.title)+'</td><td>'+esc(x.description||'')+'</td><td>'+esc(x.due_date||'—')+'</td><td>'+esc(x.status||'open')+'</td><td>'+esc(names[x.assigned_to]||'Unassigned')+'</td><td>'+esc(x.rejection_reason||'')+'</td><td>'+
      (mine&&x.status==='open'?'<button class="btn" data-accept-task="'+x.id+'">Accept</button> <button class="btn danger" data-reject-task="'+x.id+'">Reject</button> ':'')+
      (canEdit?'<button class="btn" data-edit-task="'+x.id+'">Edit</button> ':'')+
      (profile?.role==='owner'?'<button class="btn danger" data-delete-task="'+x.id+'">Delete</button>':'')+'</td></tr>'}).join('')+'</table>'
    : '<div class="state">No facility tasks.</div>';
  $$('[data-accept-task]').forEach(b=>b.onclick=async()=>{try{await api('/rest/v1/rpc/accept_staff_task',{method:'POST',body:JSON.stringify({p_task_id:b.dataset.acceptTask})});await loadTasks()}catch(e){msg(e)}});
  $$('[data-reject-task]').forEach(b=>b.onclick=async()=>{const reason=prompt('Why are you rejecting this task?');if(!reason||!reason.trim())return;try{await api('/rest/v1/rpc/reject_staff_task',{method:'POST',body:JSON.stringify({p_task_id:b.dataset.rejectTask,p_reason:reason.trim()})});await loadTasks()}catch(e){msg(e)}});
  $$('[data-edit-task]').forEach(b=>b.onclick=()=>editTask(rows.find(x=>x.id===b.dataset.editTask)));
  $$('[data-delete-task]').forEach(b=>b.onclick=()=>deleteTestRecord('staff_task',b.dataset.deleteTask));
}
async function editTask(row=null){
  const x=row||{title:'',description:'',due_date:'',status:'open',priority:'moderate',assigned_to:null};
  const profiles=await api('/rest/v1/profiles?select=id,full_name,role,active&active=eq.true&order=full_name.asc');
  const assignOptions='<option value="">Unassigned</option>'+(profiles||[]).map(p=>'<option value="'+p.id+'" '+(p.id===x.assigned_to?'selected':'')+'>'+esc((p.full_name||p.id)+' — '+(p.role||''))+'</option>').join('');
  modal(row?'Edit task':'Add task','<form id="taskForm" class="form"><input name="title" value="'+esc(x.title)+'" placeholder="Task title" required><textarea name="description" placeholder="Description / checklist">'+esc(x.description||'')+'</textarea><input name="due" type="date" value="'+esc(x.due_date||'')+'"><label>Priority<select name="priority"><option value="low" '+(x.priority==='low'?'selected':'')+'>Low</option><option value="moderate" '+(x.priority==='moderate'?'selected':'')+'>Moderate</option><option value="high" '+(x.priority==='high'?'selected':'')+'>High</option><option value="very_high" '+(x.priority==='very_high'?'selected':'')+'>Very High</option></select></label><label>Assign to<select name="assigned_to">'+assignOptions+'</select></label><select name="status"><option '+(x.status==='open'?'selected':'')+'>open</option><option '+(x.status==='accepted'?'selected':'')+'>accepted</option><option '+(x.status==='in_progress'?'selected':'')+'>in_progress</option><option '+(x.status==='completed'?'selected':'')+'>completed</option><option '+(x.status==='rejected'?'selected':'')+'>rejected</option></select><button class="btn btn-dark">Save task</button></form>');
  $('#taskForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={title:f.get('title'),description:f.get('description')||null,due_date:f.get('due')||null,assigned_to:f.get('assigned_to')||null,status:f.get('status'),priority:f.get('priority')||'moderate'};try{await api(row?'/rest/v1/staff_tasks?id=eq.'+row.id:'/rest/v1/staff_tasks',{method:row?'PATCH':'POST',body:JSON.stringify(body)});closeModal();await loadTasks()}catch(err){msg(err)}};
}

async function loadSwimmingTimetable(){
  const rows=await api('/rest/v1/swimming_timetable?select=*&order=day_of_week.asc,start_time.asc');
  const gmReadOnly=profile?.role==='general_manager';
  const days=['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  $('#swimmingTimetableTable').innerHTML='<table><tr><th>Day</th><th>Start</th><th>End</th><th>Public display</th><th>Action</th></tr>'+
    rows.map(x=>'<tr data-swim-row="'+x.id+'"><td>'+days[x.day_of_week]+'</td><td>'+String(x.start_time).slice(0,5)+'</td><td>'+String(x.end_time).slice(0,5)+'</td><td><span class="pill">Occupied</span></td><td><button class="btn" data-edit-swim="'+x.id+'">Edit</button> <button class="btn danger" data-delete-swim="'+x.id+'">Remove</button></td></tr>').join('')+'</table>';
  $$('[data-edit-swim]').forEach(b=>b.onclick=()=>editSwimmingSlot(rows.find(x=>x.id===b.dataset.editSwim)));
  $$('[data-delete-swim]').forEach(b=>b.onclick=async()=>{if(!confirm('Remove this occupied swimming period?'))return;await api('/rest/v1/swimming_timetable?id=eq.'+encodeURIComponent(b.dataset.deleteSwim),{method:'DELETE'});loadSwimmingTimetable();});
}
function editSwimmingSlot(row){
  modal(row?'Edit occupied swimming period':'Add occupied swimming period', '<form id="swimSlotForm" class="form"><label>Day<select name="day" required>'+['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((d,i)=>'<option value="'+(i+1)+'" '+(row&&row.day_of_week===i+1?'selected':'')+'>'+d+'</option>').join('')+'</select></label><label>Start time<input name="start" type="time" required value="'+(row?String(row.start_time).slice(0,5):'09:00')+'"></label><label>End time<input name="end" type="time" required value="'+(row?String(row.end_time).slice(0,5):'10:00')+'"></label><button class="btn btn-dark" type="submit">Save</button></form>');
  $('#swimSlotForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const body={day_of_week:Number(f.get('day')),start_time:f.get('start'),end_time:f.get('end'),active:true,updated_at:new Date().toISOString()};try{if(row)await api('/rest/v1/swimming_timetable?id=eq.'+encodeURIComponent(row.id),{method:'PATCH',body:JSON.stringify(body)});else await api('/rest/v1/swimming_timetable',{method:'POST',body:JSON.stringify(body)});$('#modal').classList.remove('open');await loadSwimmingTimetable();}catch(err){msg(err)}};
  $('#modal').classList.add('open');
}
async function loadInquiries(){
  const rows=await api('/rest/v1/inquiries?select=*&order=created_at.desc');
  const allowed=inquiryTypesForRole();
  const visible=allowed===null?rows:rows.filter(x=>allowed.includes(x.inquiry_type));
  $('#inquiriesTable').innerHTML=visible.length?'<table><tr><th>Received</th><th>Customer</th><th>Contact</th><th>Type</th><th>Question</th><th>Status</th><th>Reply</th></tr>'+
    visible.map(x=>{
      const num=String(x.contact_number||'').replace(/[^0-9+]/g,'');
      const wa=num.replace(/^\+/,'');
      const msgText=encodeURIComponent('Hello '+String(x.customer_name||'')+', this is Kiteezi Recreational Center regarding your enquiry: '+String(x.message||''));
      const deleteBtn=profile?.role==='owner'?'<button class="btn danger" data-delete-inquiry="'+x.id+'">Delete</button> ':'';return '<tr data-inquiry-row="'+x.id+'"><td>'+esc(new Date(x.created_at).toLocaleString())+'</td><td>'+esc(x.customer_name)+'</td><td>'+esc(x.contact_number)+'<br><small>'+esc(x.contact_method)+'</small></td><td>'+esc(x.inquiry_type)+'</td><td>'+esc(x.message)+'</td><td>'+deleteBtn+'<select data-inquiry-status="'+x.id+'"><option '+(x.status==='new'?'selected':'')+'>new</option><option '+(x.status==='in_progress'?'selected':'')+'>in_progress</option><option '+(x.status==='replied'?'selected':'')+'>replied</option><option '+(x.status==='closed'?'selected':'')+'>closed</option></select></td><td><div class="actions"><a class="btn" href="https://wa.me/'+wa+'?text='+msgText+'" target="_blank" rel="noopener">WhatsApp</a><a class="btn" href="tel:'+num+'">Call</a></div></td></tr>';
    }).join('')+'</table>':'<div class="state">No inquiries for your role.</div>';
  document.querySelectorAll('#inquiriesTable [data-delete-inquiry]').forEach(x=>x.onclick=()=>deleteTestRecord('inquiry',x.dataset.deleteInquiry));document.querySelectorAll('#inquiriesTable [data-inquiry-status]').forEach(el=>el.onchange=async()=>{await api('/rest/v1/inquiries?id=eq.'+encodeURIComponent(el.dataset.inquiryStatus),{method:'PATCH',body:JSON.stringify({status:el.value,updated_at:new Date().toISOString()})});});
}
let notificationInitialized=false;let notificationIds=new Set();let notificationCache=new Map();let notificationPoll=null;function showAdminToast(title,message){let t=document.getElementById('adminToast');if(!t){t=document.createElement('div');t.id='adminToast';t.style.cssText='position:fixed;right:18px;bottom:18px;z-index:200;background:#1b4332;color:#fff;padding:14px 16px;border-radius:12px;box-shadow:0 8px 30px #0003;max-width:360px';document.body.appendChild(t)}t.innerHTML='<strong>'+esc(title)+'</strong><div style="margin-top:4px">'+esc(message||'')+'</div>';setTimeout(()=>t.remove(),7000);}let pendingNotificationRecord=null;
function notificationTarget(n){
  const t=String(n.reference_type||'').toLowerCase();
  if(t==='booking'||t==='bookings')return 'bookings';
  if(t==='order'||t==='orders')return 'restaurant';
  if(t==='task'||t==='tasks'||t==='staff_task')return 'tasks';
  if(t==='requisition'||t==='requisitions')return 'requisitions';
  if(t==='purchase_order'||t==='purchase_orders'||t==='purchase')return 'purchases';
  if(t==='review'||t==='reviews')return 'reviews';
  if(t==='inquiry'||t==='inquiries')return 'inquiries';
  if(t==='gallery'||t==='gallery_item'||t==='media')return 'gallery';
  if(t==='swimming_session'||t==='swimming_sessions')return 'swimming_sessions';
  if(t==='swimming_timetable'||t==='swimming_slot')return 'swimming_timetable';
  if(t==='service_log'||t==='service_tally')return 'service_tally';
  if(t==='announcement'||t==='announcements')return 'content';
  if(t==='staff'||t==='profile')return 'staff';
  return 'dashboard';
}
function focusNotificationRecord(){
  const p=pendingNotificationRecord;if(!p)return;
  const id=String(p.id||'');
  const selectors={
    bookings:'[data-b="'+CSS.escape(id)+'"]',
    restaurant:'[data-items="'+CSS.escape(id)+'"]',
    tasks:'[data-task-row="'+CSS.escape(id)+'"]',
    requisitions:'[data-req-row="'+CSS.escape(id)+'"]',
    purchases:'[data-po-row="'+CSS.escape(id)+'"]',
    reviews:'[data-review-row="'+CSS.escape(id)+'"]',
    inquiries:'[data-inquiry-row="'+CSS.escape(id)+'"]',
    gallery:'[data-gallery-row="'+CSS.escape(id)+'"]',
    swimming_sessions:'[data-swimming-session-row="'+CSS.escape(id)+'"]',
    swimming_timetable:'[data-swim-row="'+CSS.escape(id)+'"]',
    service_tally:'[data-service-row="'+CSS.escape(id)+'"]'
  };
  const el=selectors[tab]?document.querySelector(selectors[tab]):null;
  if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('highlight');setTimeout(()=>el.classList.remove('highlight'),4000);pendingNotificationRecord=null;return true;}
  return false;
}
async function consumePendingNotification(){
  const id=new URLSearchParams(location.search).get('notification');
  if(!id||!session?.user?.id)return;
  const rows=await api('/rest/v1/notifications?select=id,title,message,is_read,created_at,reference_type,reference_id&recipient_user_id=eq.'+encodeURIComponent(session.user.id)+'&id=eq.'+encodeURIComponent(id)+'&limit=1');
  const cleanUrl=new window.URL(location.href);cleanUrl.searchParams.delete('notification');
  history.replaceState(null,'',cleanUrl.pathname+(cleanUrl.search?'?'+cleanUrl.searchParams.toString():'')+cleanUrl.hash);
  const n=rows?.[0];if(n)await openNotification(n);
}
async function openNotification(n){
  const target=notificationTarget(n);
  if(!canOpenTab(target))return route('dashboard');
  pendingNotificationRecord=n.reference_id?{id:n.reference_id,type:n.reference_type}:null;
  if(n.id){await api('/rest/v1/notifications?id=eq.'+encodeURIComponent(n.id)+'&recipient_user_id=eq.'+encodeURIComponent(session.user.id),{method:'PATCH',body:JSON.stringify({is_read:true})});await loadNotifications();}
  history.replaceState(null,'','#'+target);
  await route(target);
  if(!focusNotificationRecord()&&pendingNotificationRecord){setTimeout(()=>focusNotificationRecord(),300);setTimeout(()=>{if(pendingNotificationRecord&&!focusNotificationRecord())pendingNotificationRecord=null},1800);}
}
async function loadNotifications(){if(!session?.user?.id)return;const rows=await api('/rest/v1/notifications?select=id,title,message,is_read,created_at,reference_type,reference_id&recipient_user_id=eq.'+session.user.id+'&is_read=eq.false&order=created_at.desc&limit=30');if(notificationInitialized){rows.filter(x=>!notificationIds.has(x.id)).reverse().forEach(x=>showAdminToast(x.title,x.message));}notificationIds=new Set(rows.map(x=>x.id));notificationCache=new Map(rows.map(x=>[x.id,x]));notificationInitialized=true;bindNotificationClicks();const unread=rows.filter(x=>!x.is_read).length;$('#notificationCount').textContent=String(unread);$('#notificationList').innerHTML=rows.length?rows.map(x=>'<div class="cardx notification-item" data-notification="'+esc(x.id)+'" style="margin-bottom:8px;cursor:pointer;opacity:'+(x.is_read?'0.7':'1')+'"><strong>'+esc(x.title)+'</strong><div>'+esc(x.message||'')+'</div><small class="muted">'+esc(new Date(x.created_at).toLocaleString())+'</small></div>').join(''):'<div class="state">No notifications.</div>';}
function toggleNotifications(){const p=$('#notificationPanel');p.style.display=p.style.display==='none'?'block':'none';if(p.style.display==='block')loadNotifications().catch(msg)}
function startNotificationPolling(){if(notificationPoll)clearInterval(notificationPoll);notificationPoll=setInterval(()=>{if(!document.hidden)loadNotifications().catch(()=>{});},10000);}
function bindNotificationClicks(){document.querySelectorAll('.notification-item').forEach(el=>el.onclick=async()=>{try{const n=notificationCache.get(el.dataset.notification);if(n)await openNotification(n);}catch(e){msg(e)}})}
async function markNotificationsRead(){await api('/rest/v1/notifications?recipient_user_id=eq.'+session.user.id+'&is_read=eq.false',{method:'PATCH',body:JSON.stringify({is_read:true})});await loadNotifications()}
async function loadRequisitions(){
  const rows=await api('/rest/v1/requisitions?select=*,requisition_items(id,inventory_item_id,quantity,unit_code,estimated_unit_price,actual_unit_price,actual_total,inventory_items(name,unit))&order=created_at.desc');
  const role=String(profile?.role||'').toLowerCase();
  const canManager=hasPermission('requisitions.approve.manager');
  const canGM=hasPermission('requisitions.approve.gm');
  const canCEO=hasPermission('requisitions.approve.ceo');
  $('#requisitionsTable').innerHTML=rows.length?'<table><tr><th>Number</th><th>Requester</th><th>Status</th><th>Items</th><th>Action</th></tr>'+
    rows.map(r=>{
      const items=(r.requisition_items||[]).map(i=>esc(i.inventory_items?.name||i.inventory_item_id)+' × '+esc(i.quantity)+' '+esc(i.unit_code||i.inventory_items?.unit||'')+'<br><small>Est.: '+(i.estimated_unit_price!=null?'UGX '+money(Number(i.estimated_unit_price)*Number(i.quantity||0)):'Not provided')+' · Actual: '+(i.actual_unit_price!=null?'UGX '+money(Number(i.actual_total||0)):'Pending manager')+'</small>').join('<br>');
      let actions='';
      if(r.status==='manager_pending'&&canManager) actions='<button class="btn btn-dark" data-req-actual="'+r.id+'">Enter actual cost & approve</button> <button class="btn" data-req-edit="'+r.id+'">Edit</button> <button class="btn danger" data-req-reject="'+r.id+'">Reject</button>';
      if(r.status==='gm_pending'&&canGM) actions='<button class="btn" data-req-approve="'+r.id+'" data-stage="gm">Confirm</button> <button class="btn" data-req-edit="'+r.id+'">Edit</button> <button class="btn danger" data-req-reject="'+r.id+'">Reject</button>';
      if(r.status==='ceo_pending'&&canCEO) actions='<button class="btn" data-req-approve="'+r.id+'" data-stage="ceo">Confirm & Generate PO</button> <button class="btn" data-req-edit="'+r.id+'">Edit</button> <button class="btn danger" data-req-reject="'+r.id+'">Reject</button>';
      if(profile?.role==='owner') actions += (actions?' ':'')+'<button class="btn danger" data-delete-requisition="'+r.id+'">Delete</button>';
      return '<tr data-req-row="'+r.id+'"><td>'+esc(r.requisition_number)+'</td><td>'+esc(r.requester_id)+'</td><td>'+esc(r.status)+'</td><td>'+items+'</td><td class="actions">'+actions+'</td></tr>';
    }).join('')+'</table>':'<div class="state">No requisitions.</div>';
  $$('[data-req-actual]').forEach(b=>b.onclick=()=>enterRequisitionActualCost(b.dataset.reqActual));
  $$('[data-req-approve]').forEach(b=>b.onclick=async()=>{try{await api('/rest/v1/rpc/approve_requisition',{method:'POST',body:JSON.stringify({p_requisition_id:b.dataset.reqApprove,p_action:'approved'})});await loadRequisitions();loadGeneratedPOs().catch(()=>{});}catch(e){msg(e)}});
  $$('[data-req-edit]').forEach(b=>b.onclick=()=>editRequisition(b.dataset.reqEdit));
  $$('[data-req-reject]').forEach(b=>b.onclick=async()=>{const reason=prompt('Reason for rejection (required):');if(!reason?.trim())return;try{await api('/rest/v1/rpc/approve_requisition',{method:'POST',body:JSON.stringify({p_requisition_id:b.dataset.reqReject,p_action:'rejected',p_reason:reason.trim()})});await loadRequisitions();}catch(e){msg(e)}});
  $$('[data-delete-requisition]').forEach(b=>b.onclick=()=>deleteTestRecord('requisition',b.dataset.deleteRequisition));
}
async function enterRequisitionActualCost(id){
  const rows=await api('/rest/v1/requisitions?id=eq.'+encodeURIComponent(id)+'&select=id,requisition_number,notes,requisition_items(id,inventory_item_id,quantity,unit_code,estimated_unit_price,actual_unit_price,actual_total,inventory_items(name,unit))');
  const r=rows?.[0]; if(!r)return;
  const items=Array.isArray(r.requisition_items)?r.requisition_items:[];
  if(!items.length){alert('This requisition has no items to price.');return;}
  const row=i=>'<div class="req-actual-line" data-item="'+esc(i.id)+'" style="display:grid;grid-template-columns:2fr 90px 130px 140px;gap:8px;align-items:end;margin:8px 0;padding:8px;border-bottom:1px solid #eee">'+
    '<div><strong>'+esc(i.inventory_items?.name||i.inventory_item_id)+'</strong><small class="muted" style="display:block">'+esc(i.unit_code||i.inventory_items?.unit||'')+' · Estimated: '+(i.estimated_unit_price!=null?'UGX '+money(Number(i.estimated_unit_price)*Number(i.quantity||0)):'Not provided')+'</small></div>'+
    '<div><small class="muted">Qty</small><div>'+esc(i.quantity)+'</div></div>'+
    '<label>Actual unit price<input name="actual_unit_price" type="number" min="0.01" step="0.01" value="'+esc(i.actual_unit_price??'')+'" required></label>'+
    '<div><small class="muted">Actual total</small><div class="req-actual-total">UGX '+money(Number(i.actual_total||0))+'</div></div>'+
    '</div>';
  modal('Manager — actual requisition cost','<form id="reqActualForm" class="form"><p class="muted">The department estimate is preserved. Enter the actual unit price for every item. The system calculates each total from quantity × actual unit price. This is part of approval, not a requisition edit.</p><div id="reqActualLines">'+items.map(row).join('')+'</div><div id="reqActualSummary" class="notice"></div><button class="btn btn-dark" type="submit">Save actual cost & approve</button></form>');
  const form=$('#reqActualForm'), lines=$('.req-actual-line',form), summary=$('#reqActualSummary');
  const refresh=()=>{
    let total=0;
    lines.forEach(line=>{
      const item=items.find(x=>x.id===line.dataset.item), unit=Number(line.querySelector('[name=actual_unit_price]')?.value||0), lineTotal=Number(item?.quantity||0)*unit; total+=lineTotal;
      const out=line.querySelector('.req-actual-total'); if(out)out.textContent='UGX '+money(lineTotal);
    });
    if(summary)summary.textContent='Actual requisition total: UGX '+money(total);
  };
  lines.forEach(line=>line.querySelector('[name=actual_unit_price]')?.addEventListener('input',refresh)); refresh();
  form.onsubmit=async e=>{
    e.preventDefault();
    const actual_items=lines.map(line=>({requisition_item_id:line.dataset.item,actual_unit_price:Number(line.querySelector('[name=actual_unit_price]').value||0)}));
    if(actual_items.some(x=>!(x.actual_unit_price>0))){alert('Enter a valid actual unit price for every item.');return;}
    try{
      const result=await api('/rest/v1/rpc/approve_requisition',{method:'POST',body:JSON.stringify({p_requisition_id:id,p_action:'approved',p_actual_items:actual_items})});
      closeModal(); await loadRequisitions(); loadGeneratedPOs().catch(()=>{});
      if(result?.status==='gm_pending')showAdminToast('Approved','Actual costs saved and requisition sent to the General Manager.');
    }catch(err){msg(err);}
  };
}
async function editRequisition(id){
  const rows=await api('/rest/v1/requisitions?id=eq.'+encodeURIComponent(id)+'&select=*,requisition_items(*)');
  const r=rows?.[0]; if(!r)return;
  const [inv]=await Promise.all([api('/rest/v1/inventory_items?select=id,name,unit&active=eq.true&order=name.asc'),loadUnitOptions()]);
  const line=(i={})=>'<div class="req-line" style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin:6px 0"><select name="item">'+inv.map(x=>'<option value="'+x.id+'" '+(x.id===i.inventory_item_id?'selected':'')+'>'+esc(x.name)+' ('+esc(x.unit)+')</option>').join('')+'</select><input name="qty" type="number" min="0.001" step="0.001" value="'+esc(i.quantity||'')+'"><select name="unit" required>'+unitOptionsHtml(i.unit_code||i.unit||'')+'</select><input name="price" type="number" min="0" step="0.01" value="'+esc(i.estimated_unit_price||'')+'"></div>';
  modal('Edit requisition — reason required','<form id="reqEditForm" class="form"><p class="muted">The edit reason becomes part of the permanent approval audit trail.</p><textarea name="reason" required placeholder="Why are you changing this requisition?"></textarea><div id="reqLines">'+(r.requisition_items||[]).map(line).join('')+'</div><button type="button" class="btn" id="addReqLine">Add item</button> <button class="btn btn-dark">Save edit and approve</button></form>');
  $('#addReqLine').onclick=()=>$('#reqLines').insertAdjacentHTML('beforeend',line());
  $('#reqEditForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const items=[...e.currentTarget.querySelectorAll('.req-line')].map(row=>({inventory_item_id:row.querySelector('[name=item]').value,quantity:Number(row.querySelector('[name=qty]').value||0),unit_code:row.querySelector('[name=unit]').value,estimated_unit_price:Number(row.querySelector('[name=price]').value||0)})).filter(x=>x.quantity>0);if(!String(f.get('reason')||'').trim())return alert('Edit reason is required.');try{await api('/rest/v1/rpc/approve_requisition',{method:'POST',body:JSON.stringify({p_requisition_id:id,p_action:'edited',p_items:items,p_reason:String(f.get('reason')).trim()})});closeModal();await loadRequisitions();}catch(err){msg(err)}};
}
async function loadGeneratedPOs(){
  const rows=await api('/rest/v1/purchase_orders?select=id,po_number,requisition_id,status,supplier,reference,total,payment_status,generated_at,received_at,paid_at&order=generated_at.desc');
  const canManage=hasPermission('purchase_orders.manage');
  setHTML('#generatedPOTable',rows.length?'<table><tr><th>PO</th><th>Source requisition</th><th>Status</th><th>Supplier</th><th>Total</th><th>Payment</th><th>Received</th><th>Actions</th></tr>'+
    rows.map(x=>'<tr data-po-row="'+x.id+'"><td>'+esc(x.po_number||x.id.slice(0,8).toUpperCase())+'</td><td>'+esc(x.reference||x.requisition_id||'')+'</td><td>'+esc(x.status||'ordered')+'</td><td>'+esc(x.supplier||'')+'</td><td>UGX '+money(x.total)+'</td><td>'+esc(x.payment_status||'unpaid')+'</td><td>'+esc(x.received_at?new Date(x.received_at).toLocaleString():'Not received')+'</td><td class="actions">'+
      (canManage&&x.status!=='received'&&x.status!=='cancelled'?'<button class="btn" data-po-receive="'+x.id+'">Receive</button> ':'')+
      (canManage&&x.payment_status!=='paid'&&x.status!=='cancelled'?'<button class="btn" data-po-paid="'+x.id+'">Mark paid</button> ':'')+
      (profile?.role==='owner'?'<button class="btn danger" data-delete-po="'+x.id+'">Delete</button>':'')+
      '</td></tr>').join('')+'</table>':'<div class="state">No generated purchase orders.</div>');
  $$('[data-po-receive]').forEach(b=>b.onclick=()=>receivePurchase(b.dataset.poReceive).catch(msg));
  $$('[data-po-paid]').forEach(b=>b.onclick=async()=>{
    try{
      await api('/rest/v1/rpc/mark_purchase_order_paid',{method:'POST',body:JSON.stringify({p_purchase_order_id:b.dataset.poPaid})});
      await loadGeneratedPOs();
    }catch(err){msg(err);}
  });
  $$('[data-delete-po]').forEach(b=>b.onclick=()=>deleteTestRecord('purchase_order',b.dataset.deletePo));
}
async function createRequisition(){
  const [inv]=await Promise.all([api('/rest/v1/inventory_items?select=id,name,unit&active=eq.true&order=name.asc'),loadUnitOptions()]);
  const line=()=>'<div class="req-new-line" style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin:6px 0"><select name="item">'+inv.map(x=>'<option value="'+x.id+'">'+esc(x.name)+' ('+esc(x.unit)+')</option>').join('')+'</select><input name="qty" type="number" min="0.001" step="0.001" placeholder="Qty" required><select name="unit" required>'+unitOptionsHtml()+'</select><input name="price" type="number" min="0" step="0.01" placeholder="Est. unit price"></div>';
  modal('New requisition','<form id="newReqForm" class="form"><p class="muted">Your request is recorded against your department and converted to a purchase order without a Manager/GM approval bottleneck.</p><textarea name="notes" placeholder="Reason / notes"></textarea><div id="newReqLines">'+line()+'</div><button type="button" class="btn" id="addNewReqLine">Add item</button> <button class="btn btn-dark">Submit requisition</button></form>');
  $('#addNewReqLine').onclick=()=>$('#newReqLines').insertAdjacentHTML('beforeend',line());
  $('#newReqForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const items=[...e.currentTarget.querySelectorAll('.req-new-line')].map(row=>({inventory_item_id:row.querySelector('[name=item]').value,quantity:Number(row.querySelector('[name=qty]').value||0),unit_code:row.querySelector('[name=unit]').value,estimated_unit_price:Number(row.querySelector('[name=price]').value||0)})).filter(x=>x.quantity>0);if(!items.length)return alert('Add at least one item.');try{await api('/rest/v1/rpc/create_requisition',{method:'POST',body:JSON.stringify({p_items:items,p_notes:f.get('notes')||null})});closeModal();await loadRequisitions();}catch(err){msg(err)}};
}
async function loadServiceTally(){
  const rows=await api('/rest/v1/service_logs?select=id,staff_id,item_id,quantity,recorded_at&order=recorded_at.desc&limit=200');
  setHTML('#serviceTallyTable',rows.length?'<table><tr><th>When</th><th>Staff</th><th>Menu item</th><th>Quantity</th><th></th></tr>'+rows.map(x=>'<tr data-service-row="'+x.id+'"><td>'+esc(x.recorded_at)+'</td><td>'+esc(x.staff_id)+'</td><td>'+esc(x.item_id)+'</td><td>'+esc(x.quantity)+'</td><td>'+(profile?.role==='owner'?'<button class="btn danger" data-delete-service="'+x.id+'">Delete</button>':'')+'</td></tr>').join('')+'</table>':'<div class="state">No service tallies recorded.</div>'); $$('[data-delete-service]').forEach(b=>b.onclick=()=>deleteTestRecord('service_log',b.dataset.deleteService));
}
async function newServiceLog(){
  const items=await api('/rest/v1/menu_items?select=id,name&order=name.asc');
  modal('Record service tally','<form id="serviceLogForm" class="form"><select name="item" required>'+items.map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join('')+'</select><input name="qty" type="number" min="0.001" step="0.001" required placeholder="Quantity served"><p class="muted">This entry is reporting/accounting data only. It does not change physical inventory.</p><button class="btn btn-dark">Record</button></form>');
  $('#serviceLogForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/rest/v1/rpc/record_service_log',{method:'POST',body:JSON.stringify({p_item_id:f.get('item'),p_quantity:Number(f.get('qty'))})});closeModal();await loadServiceTally();}catch(err){msg(err)}};
}

async function loadAccountingOverview(){
  const [income,dept,cash]=await Promise.all([
    api('/rest/v1/v_income_statement?select=code,name,account_type,amount&order=code.asc'),
    api('/rest/v1/v_department_performance?select=department,revenue,expenses,net_result&order=department.asc'),
    api('/rest/v1/v_cash_flow?select=entry_date,net_cash_movement')
  ]);
  const revenue=income.filter(x=>String(x.account_type).toLowerCase()==='revenue').reduce((a,x)=>a+Number(x.amount||0),0);
  const expenses=income.filter(x=>['expense','cost_of_sales'].includes(String(x.account_type).toLowerCase())).reduce((a,x)=>a+Number(x.amount||0),0);
  const cashMove=cash.reduce((a,x)=>a+Number(x.net_cash_movement||0),0);
  setText('#acctRevenue','UGX '+money(revenue));setText('#acctExpenses','UGX '+money(expenses));setText('#acctNet','UGX '+money(revenue-expenses));setText('#acctCash','UGX '+money(cashMove));
  setHTML('#accountingDepartments',table(['Department','Revenue','Expenses','Net'],dept,x=>[x.department||'Unassigned','UGX '+money(x.revenue), 'UGX '+money(x.expenses),'UGX '+money(x.net_result)]));
}
async function loadAccountingStatements(){
  const [income,balance]=await Promise.all([
    api('/rest/v1/v_income_statement?select=code,name,account_type,amount&order=code.asc'),
    api('/rest/v1/v_balance_sheet?select=code,name,account_type,balance&order=code.asc')
  ]);
  setHTML('#accountingIncome',table(['Code','Account','Type','Amount'],income,x=>[x.code,x.name,x.account_type,'UGX '+money(x.amount)]));
  setHTML('#accountingBalance',table(['Code','Account','Type','Balance'],balance,x=>[x.code,x.name,x.account_type,'UGX '+money(x.balance)]));
}
async function loadAccountingCash(){return loadAccountingCashReport()}
async function loadAccountingPurchasesInventory(){
  const [po,mov]=await Promise.all([
    api('/rest/v1/purchase_orders?select=id,po_number,supplier,status,payment_status,total,created_at&order=created_at.desc'),
    api('/rest/v1/stock_movements?select=id,item_id,quantity,movement_type,reason,created_at&order=created_at.desc')
  ]);
  setHTML('#accountingPurchases',table(['PO','Supplier','Status','Payment','Total'],po,x=>[x.po_number||x.id?.slice(0,8),x.supplier||'',x.status||'',x.payment_status||'', 'UGX '+money(x.total)]));
  setHTML('#accountingInventory',table(['Movement','Item','Quantity','Type','Reason','Date'],mov,x=>[x.id?.slice(0,8),x.item_id?.slice(0,8),x.quantity,x.movement_type,x.reason||'',x.created_at?new Date(x.created_at).toLocaleDateString('en-GB'):'' ]));
}
async function loadAccountingOperations(){
  const [actions,perf]=await Promise.all([
    api('/rest/v1/v_operational_action_report?select=occurred_at,actor_name,actor_role,actor_department,action,entity_type,entity_id,reason,department,source&order=occurred_at.desc&limit=250'),
    api('/rest/v1/v_performance_report?select=department,operational_actions,first_activity,last_activity&order=department.asc')
  ]);
  setHTML('#accountingActions',table(['When','Who','Role','Department','Action','Entity','Reason'],actions,x=>[
    x.occurred_at?new Date(x.occurred_at).toLocaleString('en-GB'):'',x.actor_name||'',x.actor_role||'',x.actor_department||x.department||'',x.action||'',x.entity_type||'',x.reason||''
  ]));
  setHTML('#accountingPerformance',table(['Department','Actions','First activity','Last activity'],perf,x=>[
    x.department||'Unassigned',x.operational_actions,x.first_activity?new Date(x.first_activity).toLocaleString('en-GB'):'',x.last_activity?new Date(x.last_activity).toLocaleString('en-GB'):''
  ]));
}
async function loadAccountingLedger(){
  const rows=await api('/rest/v1/v_general_ledger?select=entry_number,entry_date,source_type,source_id,description,department,status,account_code,account_name,debit,credit,line_description,line_department&order=entry_date.desc,entry_number.desc&limit=500');
  setHTML('#accountingLedger',table(['Date','Entry','Source','Account','Debit','Credit','Department','Description'],rows,x=>[
    x.entry_date,x.entry_number,x.source_type||'',(x.account_code||'')+' '+(x.account_name||''),'UGX '+money(x.debit),'UGX '+money(x.credit),x.line_department||x.department||'',x.line_description||x.description||''
  ]));
}
async function loadAccounting(){
  const view=document.querySelector('#accountingSubnav [data-accounting-view].active')?.dataset.accountingView||'overview';
  await loadAccountingView(view,true);
}
async function loadAccountingView(view,force=false){
  document.querySelectorAll('[data-accounting-view]').forEach(b=>b.classList.toggle('active',b.dataset.accountingView===view));
  document.querySelectorAll('.accounting-view').forEach(p=>{const active=p.id==='accounting-panel-'+view;p.hidden=!active});
  const loaders={overview:loadAccountingOverview,statements:loadAccountingStatements,cash:loadAccountingCash,purchases:loadAccountingPurchasesInventory,operations:loadAccountingOperations,ledger:loadAccountingLedger};
  const fn=loaders[view]||loaders.overview;
  const key='accounting:'+view;
  if(!force&&loadedTabs.has(key))return;
  await fn();loadedTabs.add(key);
}
const LOW_INVENTORY_THRESHOLD=5;
function dashboardInventoryScopes(){
  const role=String(profile?.role||'').toLowerCase();
  const managementRoles=['owner','manager','general_manager','ceo','cfo','finance_manager','reception_manager','operations_manager','supervisor'];
  if(managementRoles.includes(role))return null;
  if(role==='barista'||hasPermission('inventory.bar'))return ['bar'];
  if(role==='head_chef'||role==='chef')return ['kitchen'];
  if(role==='waitstaff'||role==='server'||role==='waiter'||hasPermission('inventory.service'))return ['service'];
  if(role==='cleaner'||role==='cleaning'||hasPermission('inventory.cleaning'))return ['cleaning'];
  if(role==='swimming_coach'||role==='head_swimming_coach'||hasPermission('inventory.swimming'))return ['swimming'];
  if(hasPermission('inventory.all')||hasPermission('inventory.view')||hasPermission('inventory.operational'))return ['bar','kitchen','service','cleaning','swimming'];
  return [];
}
function dashboardInventoryScopeLabel(scopes){
  if(scopes===null)return 'All departments';
  if(!scopes?.length)return 'No department inventory assigned';
  return scopes.map(x=>String(x).replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase())).join(' · ');
}
async function loadDashboard(){
  const d=today();
  const [b,o,stock]=await Promise.all([
    api('/rest/v1/bookings?select=id,status&booking_date=eq.'+d),
    api('/rest/v1/orders?select=id,status&status=not.eq.completed&status=not.eq.cancelled'),
    api('/rest/v1/inventory_stock?select=id,name,unit,category,current_stock,inventory_scope,station_name&active=eq.true')
  ]);
  const scopes=dashboardInventoryScopes();
  const visibleStock=Array.isArray(stock)?stock.filter(x=>scopes===null||scopes.includes(String(x.inventory_scope||'').toLowerCase())):[];
  const lowStock=visibleStock.filter(x=>Number(x.current_stock||0)<LOW_INVENTORY_THRESHOLD);
  setText('#mBookings',b.length);setText('#mPending',b.filter(x=>x.status==='pending').length);setText('#mOrders',o.length);setText('#mLow',lowStock.length);
  setText('#lowStockScopeLabel',dashboardInventoryScopeLabel(scopes)+' · Low means below '+LOW_INVENTORY_THRESHOLD+' usable units');
  setHTML('#lowStockList',lowStock.length
    ? '<div class="table-scroll"><table><thead><tr><th>Item</th><th>Available</th><th>Unit</th><th>Area</th></tr></thead><tbody>'+
      lowStock.sort((a,b)=>Number(a.current_stock||0)-Number(b.current_stock||0)).map(x=>'<tr><td>'+esc(x.name)+'</td><td><strong>'+esc(Number(x.current_stock||0))+'</strong></td><td>'+esc(x.unit||'usage')+'</td><td>'+esc(x.inventory_scope||x.station_name||'Unassigned')+'</td></tr>').join('')+
      '</tbody></table></div>'
    : '<div class="state">No low inventory in your assigned area.</div>');
  setText('#todayOps','Bookings '+b.length+' · Open orders '+o.length+' · Low inventory '+lowStock.length);
}
const TAB_LOADERS={
  dashboard:loadDashboard,bookings:loadBookings,restaurant:loadOrders,inventory:loadInventory,menu:loadMenu,
  services:loadServices,inquiries:loadInquiries,swimming_timetable:loadSwimmingTimetable,
  swimming_sessions:loadSwimmingSessions,tasks:loadTasks,content:loadContent,gallery:loadGallery,
  reviews:loadReviews,social:loadSocial,
  staff:async()=>{await Promise.all([loadStaff(),loadTeamPositions(),loadRolesAndPermissions()]);},
  customers:loadCustomers,
  accounting:loadAccounting,settings:loadSettings,requisitions:loadRequisitions,audit:loadAuditTrail,assets:loadAssets,
  purchases:loadGeneratedPOs,service_tally:loadServiceTally
};
let activeLoad=0;
const loadedTabs=new Set();
async function loadTabOnce(name,force=false){
  const loader=TAB_LOADERS[name]||loadDashboard;
  if(!force&&loadedTabs.has(name))return;
  const run=++activeLoad;
  const section=document.getElementById(name);
  section?.classList.add('is-loading');
  try{await loader();loadedTabs.add(name)}finally{if(run===activeLoad)section?.classList.remove('is-loading')}
}
function route(x){
  const requested=x||'dashboard';
  if(requested==='reports')x='accounting';
  const desired=x||'dashboard';
  tab=canOpenTab(desired)?desired:(canOpenTab('dashboard')?'dashboard':Object.keys(TAB_PERMISSIONS).find(canOpenTab)||'dashboard');
  document.querySelectorAll('[data-tab]').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));
  document.querySelectorAll('.tab').forEach(sec=>{
    const active=sec.id===tab;
    sec.classList.toggle('active',active);
    sec.hidden=!active;
    sec.setAttribute('aria-hidden',active?'false':'true');
  });
  if(tab==='restaurant'){setupPos();loadPosMenu().catch(msg)}
  return loadTabOnce(tab).catch(err=>{
    const section=document.getElementById(tab);
    const message=humanAdminError(err,'We could not load this section right now.');
    const target=section?.querySelector('[id$="Table"], [data-load-target]');
    if(target) target.innerHTML='<div class="state">'+esc(message)+' <button type="button" class="btn" data-retry-tab>Retry</button></div>';
    section?.querySelector('[data-retry-tab]')?.addEventListener('click',()=>loadTabOnce(tab,true).catch(msg));
    msg(err);
  });
}
async function loadDashboard(){
  const d=today();
  const [b,o,stock]=await Promise.all([
    api('/rest/v1/bookings?select=id,status&booking_date=eq.'+d),
    api('/rest/v1/orders?select=id,status&status=not.eq.completed&status=not.eq.cancelled'),
    api('/rest/v1/inventory_stock?select=id,reorder_level,current_stock&active=eq.true')
  ]);
  $('#mBookings').textContent=b.length;
  $('#mPending').textContent=b.filter(x=>x.status==='pending').length;
  $('#mOrders').textContent=o.length;
  $('#mLow').textContent=stock.filter(x=>Number(x.current_stock||0)<=Number(x.reorder_level||0)).length;
  $('#todayOps').textContent='Live data connected.';
}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kampala'}).format(new Date())}
async function cancelBooking(id){
  const reasons=['Customer requested cancellation','Out of stock','Customer unreachable','Operational issue','Duplicate order','Other'];
  const row=(await api('/rest/v1/bookings?id=eq.'+encodeURIComponent(id)+'&select=id,customers(name,phone),status'))?.[0];
  const customer=row?.customers?.name||'',phone=row?.customers?.phone||'';
  modal('Cancel booking','<form id="cancelBookingForm" class="form"><p>Choose the mandatory cancellation reason.</p><select name="reason" required>'+reasons.map(x=>'<option>'+esc(x)+'</option>').join('')+'</select><label><input type="checkbox" name="whatsapp" checked> Open WhatsApp with the cancellation reason after cancelling</label><textarea name="message" rows="4">'+esc('Hello '+customer+', your Kiteezi Recreational Center booking has been cancelled. Reason: '+reasons[0]+'.')+'</textarea><button type="submit" class="btn btn-dark">Cancel booking</button></form>');
  const form=$('#cancelBookingForm');form.querySelector('[name=reason]').onchange=()=>{const r=form.querySelector('[name=reason]').value;form.querySelector('[name=message]').value='Hello '+customer+', your Kiteezi Recreational Center booking has been cancelled. Reason: '+r+'.';};
  form.onsubmit=async e=>{e.preventDefault();const fd=new FormData(form),reason=String(fd.get('reason')||''),useWa=fd.get('whatsapp')==='on',textMessage=String(fd.get('message')||'').trim();try{await api('/rest/v1/rpc/admin_cancel_booking',{method:'POST',body:JSON.stringify({p_booking_id:id,p_reason:reason})});closeModal();await loadBookings();if(useWa){const digits=String(phone||'').replace(/\D/g,'');const canonical=/^07[0-9]{8}$/.test(digits)?'256'+digits.slice(1):/^7[0-9]{8}$/.test(digits)?'256'+digits:/^256[0-9]{9}$/.test(digits)?digits:'';if(canonical)window.location.href='https://wa.me/'+canonical+'?text='+encodeURIComponent(textMessage);else alert('Booking cancelled. WhatsApp was not opened because the customer phone number is not a valid international number.');}}catch(err){msg(err);}};
  $('#modal').classList.add('open');
}
async function deleteBusinessRecord(type,id,after){
  if(profile?.role!=='owner') return;
  const labels={team_position:'public position',role:'role',inventory_item:'inventory item',menu_item:'menu item',menu_category:'menu category',service:'service',sport:'sport',service_station:'preparation station',social_link:'social link',media:'website media',announcement:'announcement',review:'review',inquiry:'customer inquiry',staff_task:'task',swimming_timetable:'swimming timetable entry',gallery_item:'gallery item',customer:'customer profile',booking_bundle:'booking package'};
  const label=labels[type]||'record';
  if(!(profile?.role==='owner'||hasPermission('content.delete'))) return msg(Error('You do not have permission to delete website content.'));
  if(!confirm('Remove this '+label+' permanently? This cannot be undone.')) return;
  try{await api('/rest/v1/rpc/admin_delete_business_record',{method:'POST',body:JSON.stringify({p_type:type,p_id:id})});if(typeof after==='function')await after();}catch(e){msg(e)}
}
async function deleteTestRecord(type,id){if(profile?.role!=='owner')return;const labels={booking:'booking',order:'order',inquiry:'inquiry',purchase_order:'purchase order',stock_movement:'stock movement',menu_recipe:'recipe',review:'review',gallery_item:'gallery item',media:'website media',announcement:'announcement',service_log:'service tally',staff_task:'staff task',daily_count:'daily inventory count',notification:'notification',email_message:'email message'};const label=labels[type]||'record';if(!confirm('Delete this '+label+' permanently? This cannot be undone.'))return;try{await api('/rest/v1/rpc/owner_delete_test_record',{method:'POST',body:JSON.stringify({p_type:type,p_id:id})});if(type==='booking')await loadBookings();else if(type==='order')await loadOrders();else if(type==='requisition')await loadRequisitions();else if(type==='inquiry')await loadInquiries();else if(type==='purchase_order')await loadPurchases();else if(type==='stock_movement')await loadStockMovements();else if(type==='review')await loadReviews();else if(type==='gallery_item')await loadGallery();else if(type==='media'||type==='announcement')await loadContent();else if(type==='service_log')await loadServiceTally();else if(type==='staff_task')await loadTasks();else if(type==='daily_count')await loadDailyStock();}catch(e){msg(e)}}
async function loadBookings(){
  const filter=$('#bookingFilter')?.value||'all';
  let q='/rest/v1/bookings?select=*,customers(name,phone),services(name)&order=booking_date.desc,start_time.asc';
  if(filter!=='all')q+='&status=eq.'+encodeURIComponent(filter);
  let rows=await api(q);
  if(['head_swimming_coach','swimming_coach'].includes(String(profile?.role||'')))rows=rows.filter(r=>/swim/i.test(r.services?.name||'')||r.booking_type==='school_swimming');
  const todayDate=today();
  const todayRows=rows.filter(r=>String(r.booking_date)===todayDate);
  const upcomingRows=rows.filter(r=>String(r.booking_date)>todayDate);
  const previousRows=rows.filter(r=>String(r.booking_date)<todayDate);
  if(!(hasPermission('bookings.view')||hasPermission('bookings.manage'))){setHTML('#bookingTable','<div class="state">You do not have permission to view bookings.</div>');return;}
  const renderRows=list=>{
    if(!list.length)return '<div class="state">No bookings.</div>';
    return '<table><tr><th>Date</th><th>Customer</th><th>People</th><th>Total</th><th>Status</th><th>Payment</th><th>Actions</th></tr>'+
      list.map(r=>{
        const active=r.status!=='cancelled'&&r.status!=='completed';
        const isSchool=/school swimming/i.test(r.services?.name||'')||r.booking_type==='school_swimming';
        const actionAllowed=perm=>hasPermission(perm)&&(!isSchool||['manager','head_swimming_coach','owner'].includes(String(profile?.role||'')));
        const num=String(r.customers?.phone||'').replace(/[^0-9+]/g,'').replace(/^\+/,'');
        const customer=String(r.customers?.name||'');
        const waText=encodeURIComponent('Hello '+customer+', your booking request has been confirmed by Kiteezi Recreational Center.');
        const ceoBtn=actionAllowed('bookings.confirm')&&['ceo','owner'].includes(String(profile?.role||''))&&r.status==='pending'&&!r.ceo_approved_at?'<button class="btn" data-ceo-booking="'+r.id+'">CEO approve</button> ':'';
        const managerBtn=actionAllowed('bookings.confirm')&&['manager','owner'].includes(String(profile?.role||''))&&r.status==='pending'&&r.ceo_approved_at?'<button class="btn" data-manager-booking="'+r.id+'" data-wa="'+num+'" data-watext="'+waText+'">Manager confirm</button> ':'';
        const paidBtn=actionAllowed('bookings.pay')&&r.payment_status!=='paid'&&r.status!=='cancelled'?'<button class="btn" data-paid-booking="'+r.id+'">Paid</button> ':'';
        const completeBtn=actionAllowed('bookings.complete')&&active?'<button class="btn" data-complete-booking="'+r.id+'">Completed</button> ':'';
        const cancelBtn=actionAllowed('bookings.cancel')&&active?'<button class="btn" data-cancel-booking="'+r.id+'">Cancel</button> ':'';
        const deleteBtn=hasPermission('bookings.delete')?'<button class="btn danger" data-delete-booking="'+r.id+'">Delete</button> ':'';
        return '<tr data-b="'+r.id+'"><td>'+esc(r.booking_date)+' '+esc(r.start_time||'')+'</td><td>'+esc(customer)+'<br>'+esc(r.customers?.phone||'')+'</td><td>'+esc(r.people)+'</td><td>UGX '+money(r.total)+'</td><td>'+esc(r.status)+(r.ceo_approved_at?' · CEO approved':'')+'</td><td>'+esc(r.payment_status||'unpaid')+'</td><td class="actions">'+ceoBtn+managerBtn+paidBtn+completeBtn+cancelBtn+deleteBtn+'</td></tr>';
      }).join('')+'</table>';
  };
  setHTML('#bookingTable','<h3>Today\'s bookings</h3>'+renderRows(todayRows)+'<h3 style="margin-top:24px">Upcoming bookings</h3>'+renderRows(upcomingRows)+'<h3 style="margin-top:24px">Previous bookings</h3>'+renderRows(previousRows));
}
async function setBookingStatus(id,status,payment){
  await api('/rest/v1/rpc/admin_update_booking',{method:'POST',body:JSON.stringify({p_booking_id:id,p_status:status||null,p_payment_status:payment||null})});
  await loadBookings();
}
async function handleBookingActionClick(e){
  const button=e.target.closest('[data-ceo-booking],[data-manager-booking],[data-paid-booking],[data-complete-booking],[data-cancel-booking],[data-delete-booking]');
  if(!button)return;
  if(button.dataset.busy==='1')return;
  button.dataset.busy='1';
  const original=button.textContent;
  button.disabled=true;
  try{
    if(button.dataset.ceoBooking){
      button.textContent='CEO approving…';
      await api('/rest/v1/rpc/ceo_approve_booking',{method:'POST',body:JSON.stringify({p_booking_id:button.dataset.ceoBooking})});
      await loadBookings();
    }else if(button.dataset.managerBooking){
      button.textContent='Confirming…';
      const result=await api('/rest/v1/rpc/manager_confirm_booking',{method:'POST',body:JSON.stringify({p_booking_id:button.dataset.managerBooking})});
      await loadBookings();
      const phone=button.dataset.wa||'';
      const message=button.dataset.watext||encodeURIComponent(result?.customer_message||'Your Kiteezi booking has been confirmed.');
      if(phone) openWhatsApp(phone,message);
    }else if(button.dataset.paidBooking){
      button.textContent='Saving…';
      await setBookingStatus(button.dataset.paidBooking,null,'paid');
    }else if(button.dataset.completeBooking){
      button.textContent='Completing…';
      await setBookingStatus(button.dataset.completeBooking,'completed',null);
    }else if(button.dataset.cancelBooking){
      button.disabled=false;
      button.dataset.busy='0';
      await cancelBooking(button.dataset.cancelBooking);
      return;
    }else if(button.dataset.deleteBooking){
      button.disabled=false;
      button.dataset.busy='0';
      await deleteTestRecord('booking',button.dataset.deleteBooking);
      return;
    }
  }catch(err){
    msg(err);
  }finally{
    button.disabled=false;
    button.dataset.busy='0';
    button.textContent=original;
  }
}
function openWhatsApp(phone,textMessage){const raw=String(phone||'').trim();let digits=raw.replace(/\D/g,'');if(digits.startsWith('00'))digits=digits.slice(2);if(digits.startsWith('0'))digits='256'+digits.slice(1);if(!digits.startsWith('256')&&digits.length===9)digits='256'+digits;if(!/^2567\d{8}$/.test(digits)){msg(new Error('This booking does not have a valid Uganda WhatsApp number.'));return false;}window.location.href='https://wa.me/'+digits+'?text='+textMessage;return true}
async function setBookingAndWhatsApp(id,status,payment,wa,textMessage){
  const raw=String(wa||'').trim();
  let digits=raw.replace(/\D/g,'');
  if(digits.startsWith('00'))digits=digits.slice(2);
  if(digits.startsWith('0'))digits='256'+digits.slice(1);
  if(!digits.startsWith('256')&&digits.length===9)digits='256'+digits;
  if(!/^2567\d{8}$/.test(digits)){msg(new Error('This booking does not have a valid Uganda WhatsApp number.'));return}
  try{await setBookingStatus(id,status,payment)}catch(e){msg(e);return}
  window.location.href='https://wa.me/'+digits+'?text='+textMessage;
}
async function loadStationOrders(){
  const station=profile?.role==='barista'?'Barista':'Kitchen';
  const rows=await api('/rest/v1/rpc/get_station_order_details',{method:'POST',body:JSON.stringify({p_station:station})});
  const filter=$('#orderStatusFilter')?.value||'all';
  const visible=(rows||[]).filter(x=>filter==='all'||x.order_status===filter);
  $('#ordersTable').innerHTML=visible.length
    ? '<table><tr><th>Order</th><th>Customer</th><th>Items</th><th>Fulfillment</th><th>Status</th><th>Station</th><th>Action</th></tr>'+
      visible.map(r=>{
        const items=Array.isArray(r.items)?r.items:[];
        const itemHtml=items.length?items.map(i=>'<div class="order-item"><strong>'+esc(i.name||'Item')+'</strong> × '+esc(i.qty)+((i.notes)?'<br><small>Note: '+esc(i.notes)+'</small>':'')+'</div>').join(''):'<span class="muted">No items assigned</span>';
        const label=r.station_status==='waiting'?'Waiting':r.station_status==='accepted'?'Accepted':r.station_status==='in_progress'?'In Progress':r.station_status==='cancelled'?'Cancelled':'Complete';
        const action=(r.order_status==='pending'||r.order_status==='open'||r.order_status==='confirmed')
          ? '<select data-station-status="'+r.order_id+'" data-station-id="'+r.station_id+'"><option value="waiting" '+(r.station_status==='waiting'?'selected':'')+'>Waiting</option><option value="accepted" '+(r.station_status==='accepted'?'selected':'')+'>Accepted</option><option value="in_progress" '+(r.station_status==='in_progress'?'selected':'')+'>In Progress</option><option value="complete" '+(r.station_status==='complete'?'selected':'')+'>Complete</option><option value="cancelled" '+(r.station_status==='cancelled'?'selected':'')+'>Cancelled</option></select>'+
          ((r.station_status!=='complete'&&r.station_status!=='cancelled')?'<button type="button" class="btn danger" data-station-cancel="'+r.order_id+'" data-station-id="'+r.station_id+'">Cancel</button>':'')
          : '<span class="pill">'+esc(label)+'</span>';
        return '<tr><td>#'+esc(r.order_id.slice(0,8).toUpperCase())+'<br><small>'+esc(r.source||'Website')+'</small></td><td>'+esc(r.customer_name||'Customer')+'<br><small>'+esc(r.customer_phone||'')+'</small></td><td>'+itemHtml+'</td><td>'+esc(String(r.fulfillment_method||'pickup').replace('_',' '))+'</td><td>'+esc(r.order_status)+'</td><td><span class="pill">'+esc(label)+'</span></td><td>'+action+'</td></tr>';
      }).join('')+'</table>'
    : '<div class="state">No active '+esc(station.toLowerCase())+' station orders.</div>';
  document.querySelectorAll('[data-station-cancel]').forEach(x=>x.onclick=async()=>{
    const reason=prompt('Why is this station cancelling the work?'); if(!reason||!reason.trim())return;
    try{await api('/rest/v1/rpc/set_order_station_status',{method:'POST',body:JSON.stringify({p_order_id:x.dataset.stationCancel,p_station_id:x.dataset.stationId,p_status:'cancelled',p_reason:reason.trim()})});await loadStationOrders()}catch(e){msg(e);await loadStationOrders()}
  });
  document.querySelectorAll('[data-station-status]').forEach(x=>x.onchange=async()=>{
    try{await api('/rest/v1/rpc/set_order_station_status',{method:'POST',body:JSON.stringify({p_order_id:x.dataset.stationStatus,p_station_id:x.dataset.stationId,p_status:x.value})});await loadStationOrders()}catch(e){msg(e);await loadStationOrders()}
  });
}

async function loadReceptionOrders(){
  const rows=await api('/rest/v1/rpc/get_reception_active_orders',{method:'POST'});
  const filter=$('#orderStatusFilter')?.value||'all';
  const visible=(rows||[]).filter(x=>filter==='all'||x.order_status===filter);
  $('#ordersTable').innerHTML=visible.length
    ? '<table><tr><th>Order</th><th>Received</th><th>Status</th><th>Station Progress</th></tr>'+
      visible.map(r=>{
        const stations=Array.isArray(r.stations)?r.stations:[];
        const html=stations.map(x=>'<span class="pill">'+esc(x.station)+': '+esc(x.status)+'</span>').join(' ');
        return '<tr><td>#'+esc(r.order_id.slice(0,8).toUpperCase())+'</td><td>'+esc(new Date(r.created_at).toLocaleString())+'</td><td>'+esc(r.order_status)+'</td><td>'+html+'</td></tr>';
      }).join('')+'</table>'
    : '<div class="state">No active orders for guest tracking.</div>';
}

/* === Integrated Orders / POS === */
const POS_IMAGE_MAP={
  burger:'https://images.unsplash.com/photo-1767065703793-7012f5fced19?auto=format&fit=crop&w=900&q=80',
  pizza:'https://images.unsplash.com/photo-1751368647711-2e2ee6d0b7c6?auto=format&fit=crop&w=900&q=80',
  chicken:'https://images.unsplash.com/photo-1725728286008-6bdec0508a71?auto=format&fit=crop&w=900&q=80',
  fish:'https://images.unsplash.com/photo-1519233991914-26a44330ccd7?auto=format&fit=crop&w=900&q=80',
  salad:'https://images.unsplash.com/photo-1568106690134-f2ee2257a9ef?auto=format&fit=crop&w=900&q=80',
  juice:'https://images.unsplash.com/photo-1617535394182-641e70651cd8?auto=format&fit=crop&w=900&q=80',
  coffee:'https://images.unsplash.com/photo-1681477508108-6d3164936ac4?auto=format&fit=crop&w=900&q=80',
  milkshake:'https://images.unsplash.com/photo-1553787499-6f9133860278?auto=format&fit=crop&w=900&q=80',
  beer:'https://images.unsplash.com/photo-1597822738124-151fb72dcb79?auto=format&fit=crop&w=900&q=80',
  wine:'https://images.unsplash.com/photo-1610458034932-dc165f29499e?auto=format&fit=crop&w=900&q=80',
  whiskey:'https://images.unsplash.com/photo-1671713682265-991d47c88b85?auto=format&fit=crop&w=900&q=80',
  breakfast:'https://images.unsplash.com/photo-1734770205674-d117e4ba7926?auto=format&fit=crop&w=900&q=80',
  hotpot:'https://www.asiancookingmom.com/wp-content/uploads/2023/01/Hot-Pot-15-of-17-1.jpg',
  samosa:'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=900&q=80',
  default:'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80'
};
let posMenuItems=[],posCategories=[],posActiveCategory='',posCartItems=[],posMenuLoaded=false;
function posMoney(v){return 'UGX '+new Intl.NumberFormat('en-UG').format(Number(v)||0)}
function posImageFor(item){
  if(item?.img_url)return item.img_url;
  const hay=(String(item?.name||'')+' '+String(item?.category||'')).toLowerCase();
  for(const key of Object.keys(POS_IMAGE_MAP)){if(key!=='default'&&hay.includes(key))return POS_IMAGE_MAP[key]}
  if(/goat|liver|beef|meat|steak|muchomo|sausage|kebab|chapati|rolex|chips|samosa|katogo|buffet|snack/.test(hay))return POS_IMAGE_MAP.chicken;
  if(/whisk|spirit|gin|vodka|cream|champagne/.test(hay))return POS_IMAGE_MAP.whiskey;
  if(/wine/.test(hay))return POS_IMAGE_MAP.wine;
  if(/beer|lager|stout|cider/.test(hay))return POS_IMAGE_MAP.beer;
  if(/juice|drink/.test(hay))return POS_IMAGE_MAP.juice;
  if(/breakfast/.test(hay))return POS_IMAGE_MAP.breakfast;
  if(/hot pot|hotpot/.test(hay))return POS_IMAGE_MAP.hotpot;
  return POS_IMAGE_MAP.default;
}
function posSetStatus(message,error=false){
  const el=$('#posStatus');if(!el)return;
  el.textContent=message||'';el.classList.toggle('show',!!message);el.style.color=error?'#8b2222':'';
}
function posCartTotal(){return posCartItems.reduce((s,x)=>s+(Number(x.price)||0)*(Number(x.quantity)||0),0)}
function posRenderCategories(){
  const box=$('#posCategoryTabs');if(!box)return;
  const all=[{id:'',name:'All categories'}].concat(posCategories);
  box.innerHTML=all.map(c=>'<button type="button" role="tab" class="'+(String(c.id)===String(posActiveCategory)?'active':'')+'" data-pos-category="'+esc(c.id)+'">'+esc(c.name)+'</button>').join('');
  box.querySelectorAll('[data-pos-category]').forEach(b=>b.onclick=()=>{posActiveCategory=b.dataset.posCategory||'';posRenderCategories();posRenderProducts()});
}
function posRenderProducts(){
  const box=$('#posProducts'),status=$('#posMenuStatus');if(!box||!status)return;
  const q=String($('#posSearch')?.value||'').trim().toLowerCase();
  const rows=posMenuItems.filter(x=>{
    const hay=[x.name,x.description,x.category,x.serving_unit].map(v=>String(v||'').toLowerCase()).join(' ');
    return (!q||hay.includes(q))&&(!posActiveCategory||String(x.category_id)===String(posActiveCategory));
  });
  status.textContent=rows.length?rows.length+' menu item'+(rows.length===1?'':'s')+' available':'No menu items match your search.';
  box.innerHTML=rows.map(x=>{
    const image=posImageFor(x),qty=posCartItems.find(i=>i.id===x.id)?.quantity||0;
    return '<article class="pos-product"><div class="pos-product-media"><img src="'+esc(image)+'" alt="'+esc(x.alt_text||x.name)+'" loading="lazy" onerror="this.src=\''+POS_IMAGE_MAP.default+'\'"></div><div class="pos-product-body"><div class="pos-product-name">'+esc(x.name)+'</div><div class="pos-product-meta">'+esc(x.description||x.serving_unit||x.category||'')+'</div><div class="pos-product-foot"><span class="pos-product-price">'+posMoney(x.price)+'</span><button type="button" class="btn btn-dark pos-add" data-pos-add="'+esc(x.id)+'">'+(qty?'+'+qty:'Add')+'</button></div></div></article>';
  }).join('');
  box.querySelectorAll('[data-pos-add]').forEach(b=>b.onclick=()=>posAddItem(b.dataset.posAdd));
}
function posRenderCart(){
  const box=$('#posCart'),count=$('#posCartCount'),sub=$('#posSubtotal'),total=$('#posTotal');
  const n=posCartItems.reduce((s,x)=>s+Number(x.quantity||0),0),sum=posCartTotal();
  if(count)count.textContent=n+' item'+(n===1?'':'s');
  if(sub)sub.textContent=posMoney(sum);
  if(total)total.textContent=posMoney(sum);
  if(!box)return;
  box.innerHTML=posCartItems.length?posCartItems.map(x=>{
    const image=posImageFor(x);
    return '<div class="pos-cart-line"><div class="pos-cart-thumb"><img src="'+esc(image)+'" alt="" loading="lazy"></div><div><div class="pos-cart-line-name">'+esc(x.name)+'</div><div class="pos-cart-line-price">'+posMoney(x.price)+' each</div><div class="pos-qty"><button type="button" data-pos-dec="'+x.id+'">−</button><span>'+x.quantity+'</span><button type="button" data-pos-inc="'+x.id+'">+</button></div></div><div><strong>'+posMoney((Number(x.price)||0)*x.quantity)+'</strong><button type="button" class="pos-remove" aria-label="Remove '+esc(x.name)+'" data-pos-remove="'+x.id+'">×</button></div></div>';
  }).join(''):'<div class="state">No items yet.</div>';
  box.querySelectorAll('[data-pos-inc]').forEach(b=>b.onclick=()=>posChangeQty(b.dataset.posInc,1));
  box.querySelectorAll('[data-pos-dec]').forEach(b=>b.onclick=()=>posChangeQty(b.dataset.posDec,-1));
  box.querySelectorAll('[data-pos-remove]').forEach(b=>b.onclick=()=>posRemoveItem(b.dataset.posRemove));
  posRenderProducts();
}
function posAddItem(id){
  const item=posMenuItems.find(x=>x.id===id);if(!item)return;
  const existing=posCartItems.find(x=>x.id===id);
  if(existing)existing.quantity+=1;else posCartItems.push({...item,quantity:1});
  posRenderCart();
}
function posChangeQty(id,delta){
  const item=posCartItems.find(x=>x.id===id);if(!item)return;
  item.quantity=Math.max(0,item.quantity+delta);
  if(!item.quantity)posRemoveItem(id);else posRenderCart();
}
function posRemoveItem(id){posCartItems=posCartItems.filter(x=>x.id!==id);posRenderCart()}
function posClear(){posCartItems=[];posRenderCart();posSetStatus('')}
async function loadPosMenu(force=false){
  const shell=document.querySelector('.pos-shell');if(!shell)return;
  if(!hasPermission('orders.create')&&!hasPermission('orders.manage')){shell.hidden=true;return}
  shell.hidden=false;
  if(posMenuLoaded&&!force)return;
  try{
    const [cats,items]=await Promise.all([
      api('/rest/v1/menu_categories?select=id,name,sort_order&active=eq.true&order=sort_order.asc,name.asc'),
      api('/rest/v1/menu_items?select=id,name,description,price,price_on_request,in_stock,img_url,alt_text,category_id,serving_unit,menu_categories(name)&in_stock=eq.true&price_on_request=eq.false&order=name.asc')
    ]);
    posCategories=Array.isArray(cats)?cats:[];
    posMenuItems=(Array.isArray(items)?items:[]).map(x=>({...x,category:x.menu_categories?.name||'Other'}));
    posMenuLoaded=true;posRenderCategories();posRenderProducts();posRenderCart();
    $('#posMenuStatus').textContent=posMenuItems.length+' menu items available';
  }catch(e){posMenuLoaded=false;const el=$('#posMenuStatus');if(el)el.textContent='Unable to load the live menu. Please refresh and try again.';msg(e)}
}
function posPaymentModal(){
  if(!posCartItems.length){posSetStatus('Add at least one item before proceeding to payment.',true);return}
  if(!hasPermission('orders.pay')&&!hasPermission('orders.manage')){
    posCreateUnpaidOrder().catch(msg);return;
  }
  const total=posCartTotal();
  modal('Payment','<form id="posPaymentForm" class="pos-payment-form"><div class="pos-payment-total"><span>Order total</span><span>'+posMoney(total)+'</span></div><div class="pos-payment-grid"><button type="button" class="pos-payment-choice active" data-pay-method="cash">Cash<small>Pay at counter</small></button><button type="button" class="pos-payment-choice" data-pay-method="mtn_momo">MTN Mobile Money<small>Manual confirmation</small></button><button type="button" class="pos-payment-choice" data-pay-method="airtel_money">Airtel Money<small>Manual confirmation</small></button></div><input type="hidden" name="method" value="cash"><div id="posPaymentFields"></div><div id="posPaymentError"></div><button class="btn btn-dark" type="submit">Complete Payment &amp; Save Order</button><p class="pos-payment-note">Mobile-money payment is recorded after the cashier confirms the transaction. This does not initiate a mobile-money transfer.</p></form>');
  const form=$('#posPaymentForm'),methodInput=form.querySelector('[name=method]'),fields=$('#posPaymentFields'),error=$('#posPaymentError');
  const renderFields=()=>{const method=methodInput.value;if(method==='cash')fields.innerHTML='<input name="received" type="number" min="'+total+'" step="1" placeholder="Amount received (UGX)" required><div id="posChange" class="muted"></div>';else fields.innerHTML='<input name="reference" type="text" maxlength="80" placeholder="Transaction/reference number (optional)">';};
  form.querySelectorAll('[data-pay-method]').forEach(b=>b.onclick=()=>{form.querySelectorAll('[data-pay-method]').forEach(x=>x.classList.remove('active'));b.classList.add('active');methodInput.value=b.dataset.payMethod;renderFields()});
  renderFields();
  form.onsubmit=async e=>{
    e.preventDefault();error.innerHTML='';
    const fd=new FormData(form),method=String(fd.get('method')),received=Number(fd.get('received')||0);
    if(method==='cash'&&received<total){error.innerHTML='<div class="pos-payment-error">Amount received must be at least '+posMoney(total)+'.</div>';return}
    const submit=e.currentTarget.querySelector('button[type=submit]');submit.disabled=true;submit.textContent='Saving…';
    try{
      const orderId=await api('/rest/v1/rpc/create_pos_order_v2',{method:'POST',body:JSON.stringify({p_customer_name:$('#posCustomerName')?.value?.trim()||null,p_phone:$('#posPhone')?.value?.trim()||null,p_items:posCartItems.map(x=>({id:x.id,quantity:x.quantity})),p_notes:$('#posNotes')?.value?.trim()||null,p_fulfillment_method:$('#posFulfillment')?.value||'dine_in'})});
      const reference=method==='cash'?'Cash received '+received+'; change '+(received-total):String(fd.get('reference')||'').trim()||null;
      await api('/rest/v1/rpc/record_pos_payment',{method:'POST',body:JSON.stringify({p_order_id:orderId,p_payment_method:method,p_reference:reference})});
      closeModal();posClear();$('#posCustomerName').value='';$('#posPhone').value='';$('#posNotes').value='';
      posSetStatus('Order #'+String(orderId).slice(0,8).toUpperCase()+' saved and marked paid. It remains open until the authorized order confirmation workflow starts preparation.');
      await loadOrders();
    }catch(err){error.innerHTML='<div class="pos-payment-error">'+esc(humanAdminError(err,'We could not complete this POS payment. The order was not marked paid.'))+'</div>';msg(err);submit.disabled=false;submit.textContent='Complete Payment & Save Order'}
  };
}
async function posCreateUnpaidOrder(){
  const submit=$('#posPay');if(submit)submit.disabled=true;
  try{
    const orderId=await api('/rest/v1/rpc/create_pos_order_v2',{method:'POST',body:JSON.stringify({p_customer_name:$('#posCustomerName')?.value?.trim()||null,p_phone:$('#posPhone')?.value?.trim()||null,p_items:posCartItems.map(x=>({id:x.id,quantity:x.quantity})),p_notes:$('#posNotes')?.value?.trim()||null,p_fulfillment_method:$('#posFulfillment')?.value||'dine_in'})});
    posClear();posSetStatus('Order #'+String(orderId).slice(0,8).toUpperCase()+' sent to the manager for confirmation. Payment is handled separately by the manager.');
    await loadOrders();
  }catch(err){posSetStatus(humanAdminError(err,'We could not save this order.'),true);msg(err)}
  finally{if(submit)submit.disabled=false}
}

function stationNameForRole(){
  if(profile?.role==='chef'||profile?.role==='head_chef') return 'Kitchen';
  if(profile?.role==='barista') return 'Barista';
  return null;
}
function stationStatusLabel(s){
  return ({waiting:'Waiting',accepted:'Accepted',in_progress:'In Progress',complete:'Completed',cancelled:'Cancelled'}[String(s||'').toLowerCase()]||String(s||''));
}
async function loadStationOrders(){
  const station=stationNameForRole();
  const box=$('#stationOrdersTable');
  if(!station||!box)return [];
  $('#stationWorkTitle').textContent=station+' Orders';
  try{
    const rows=await api('/rest/v1/rpc/get_station_order_details',{method:'POST',body:JSON.stringify({p_station:station})});
    const safe=Array.isArray(rows)?rows:[];
    if(!safe.length){box.innerHTML='<div class="state">No orders currently assigned to '+esc(station)+'.</div>';return safe;}
    box.innerHTML=safe.map(r=>{
      const status=String(r.station_status||'waiting').toLowerCase();
      const items=Array.isArray(r.items)?r.items:[];
      const buttons=[];
      if(status==='waiting') buttons.push('<button class="btn btn-dark" data-station-action="accepted" data-order-id="'+esc(r.order_id)+'" data-station-id="'+esc(r.station_id)+'">Accept</button>');
      if(status==='accepted') buttons.push('<button class="btn btn-dark" data-station-action="in_progress" data-order-id="'+esc(r.order_id)+'" data-station-id="'+esc(r.station_id)+'">Start preparation</button>');
      if(status==='in_progress') buttons.push('<button class="btn btn-dark" data-station-action="complete" data-order-id="'+esc(r.order_id)+'" data-station-id="'+esc(r.station_id)+'">Mark completed</button>');
      return '<article class="station-order-card">'+
        '<div class="toolbar"><div><strong>Order #'+esc(String(r.order_id).slice(0,8).toUpperCase())+'</strong><div class="muted">'+esc(r.customer_name||'Customer')+'</div></div><span class="pill">'+esc(stationStatusLabel(status))+'</span></div>'+
        '<div class="station-order-items">'+(items.length?items.map(x=>'<div><strong>'+esc(x.qty)+' × '+esc(x.name)+'</strong>'+(x.notes?'<span class="muted"> — '+esc(x.notes)+'</span>':'')+'</div>').join(''):'<div class="muted">No items assigned.</div>')+'</div>'+
        '<div class="toolbar"><span class="muted">Whole order: '+esc(r.order_status||'')+'</span><div class="toolbar-actions">'+buttons.join('')+'</div></div>'+
      '</article>';
    }).join('');
    return safe;
  }catch(e){
    box.innerHTML='<div class="state danger">'+esc(humanAdminError(e,'Station orders could not be loaded.'))+'</div>';
    return [];
  }
}
async function changeStationOrderStatus(orderId,stationId,status){
  try{
    await api('/rest/v1/rpc/set_order_station_status',{method:'POST',body:JSON.stringify({
      p_order_id:orderId,p_station_id:stationId,p_status:status,p_reason:null
    })});
    await loadStationOrders();
  }catch(e){msg(e);}
}

function setOrderMainView(view){
  const key=String(view||'new');
  const create=$('#orderCreatePanel'), manage=$('#orderManagementPanel'), station=$('#stationWorkPanel');
  const stationRole=!!stationNameForRole();
  if(!create||!manage)return;
  if(stationRole){
    create.hidden=true;
    manage.hidden=true;
    if(station)station.hidden=key!=='station';
    $$('#ordersMainNav [data-order-main]').forEach(b=>{
      b.hidden=b.dataset.orderMain!=='station';
      b.classList.toggle('active',b.dataset.orderMain===key);
    });
    if(key==='station')loadStationOrders();
    return;
  }
  if(station)station.hidden=true;
  create.hidden=key!=='new';
  manage.hidden=key==='new';
  if(key!=='new') setOrderView(key==='status'?'status':key==='items'?'items':'orders');
  $$('#ordersMainNav [data-order-main]').forEach(b=>{
    b.hidden=false;
    b.classList.toggle('active',b.dataset.orderMain===key);
  });
}
function setOrderView(view){
  const orders=$('#ordersTable'),items=$('#orderItemsTable');
  if(!orders||!items)return;
  const key=String(view||'orders');
  orders.hidden=key==='items';
  items.hidden=key!=='items';
  orders.classList.toggle('order-view-status',key==='status');
  orders.classList.toggle('order-view-orders',key==='orders');
  $('#ordersSubnav [data-order-view]').forEach(b=>b.classList.toggle('active',b.dataset.orderView===key));
}
function setupOrderViews(){
  const main=$('#ordersMainNav');
  const stationRefresh=$('#refreshStationOrders');
  if(stationRefresh&&!stationRefresh.dataset.bound){
    stationRefresh.dataset.bound='1';
    stationRefresh.addEventListener('click',()=>loadStationOrders());
  }
  const stationBox=$('#stationOrdersTable');
  if(stationBox&&!stationBox.dataset.bound){
    stationBox.dataset.bound='1';
    stationBox.addEventListener('click',e=>{
      const b=e.target.closest('[data-station-action]');
      if(!b)return;
      b.disabled=true;
      changeStationOrderStatus(b.dataset.orderId,b.dataset.stationId,b.dataset.stationAction);
    });
  }
  if(main&&!main.dataset.bound){
    main.dataset.bound='1';
    main.addEventListener('click',e=>{
      const b=e.target.closest('[data-order-main]');if(!b)return;
      setOrderMainView(b.dataset.orderMain);
    });
  }
  const sub=$('#ordersSubnav');if(!sub||sub.dataset.bound)return;
  sub.dataset.bound='1';
  sub.addEventListener('click',e=>{
    const b=e.target.closest('[data-order-view]');if(!b)return;
    setOrderView(b.dataset.orderView);
  });
  if(!document.getElementById('kiteezi-order-view-style')){
    const style=document.createElement('style');
    style.id='kiteezi-order-view-style';
    style.textContent='#ordersTable.order-view-orders table th:nth-child(5),#ordersTable.order-view-orders table td:nth-child(5){display:none}#ordersTable.order-view-status table th:nth-child(3),#ordersTable.order-view-status table td:nth-child(3),#ordersTable.order-view-status table th:nth-child(6),#ordersTable.order-view-status table td:nth-child(6),#ordersTable.order-view-status table th:nth-child(7),#ordersTable.order-view-status table td:nth-child(7){display:none}';
    document.head.appendChild(style);
  }
  setOrderView('orders');
  setOrderMainView(stationNameForRole()?'station':'new');
}
function setupPos(){
  if(window.__KITEEZI_POS_BOUND__)return;window.__KITEEZI_POS_BOUND__=true;
  $('#posSearch')?.addEventListener('input',posRenderProducts);
  $('#posRefreshMenu')?.addEventListener('click',()=>loadPosMenu(true).catch(msg));
  $('#posClear')?.addEventListener('click',posClear);
  $('#posPay')?.addEventListener('click',posCreateUnpaidOrder);
  $('#posFulfillment')?.addEventListener('change',()=>{const x=$('#posFulfillment');const l=$('#posOrderTypeLabel');if(l)l.textContent=x?.selectedOptions?.[0]?.textContent||'Dine in'});
}

async function loadOrders(){
  if(profile?.role==='reception_manager'){await loadReceptionOrders();return;}
  if(['chef','barista'].includes(profile?.role)){await loadStationOrders();return;}
  const filter=$('#orderStatusFilter').value;
  let q='/rest/v1/orders?select=*,customers(name,phone)&order=created_at.desc';
  if(filter!=='all')q+='&status=eq.'+filter;
  let rows=await api(q);
  if(!rows.length){
    $('#ordersTable').innerHTML='<div class="state">No orders have been recorded yet.</div>';
    return;
  }
  if(['chef','barista'].includes(profile?.role)){
    const oi=await api('/rest/v1/order_items?select=order_id,menu_items(name,station_id,service_stations(name))');
    const target=profile.role==='barista'?'Barista':'Kitchen';
    const visibleIds=new Set(oi.filter(x=>(x.menu_items?.service_stations?.name||'')===target).map(x=>x.order_id));
    rows=rows.filter(x=>visibleIds.has(x.id));
  }
  const ids=rows.map(x=>x.id);
  const progress=ids.length?await api('/rest/v1/order_station_progress?select=order_id,station_id,status,cancellation_reason,cancelled_at,service_stations(name,sort_order)&order=order_id.asc,station_id.asc'):[]; 
  const byOrder={};progress.forEach(x=>(byOrder[x.order_id]??=[]).push(x));
  const canGlobalComplete=hasPermission('orders.complete');
  const stationRows=(id)=>byOrder[id]||[];
  const normalizePhone=value=>{
    let v=String(value||'').trim().replace(/[^0-9+]/g,'');
    if(v.startsWith('+'))return v;
    if(v.startsWith('00'))return '+'+v.slice(2);
    if(/^07[0-9]{8}$/.test(v))return '+256'+v.slice(1);
    if(/^7[0-9]{8}$/.test(v))return '+256'+v;
    if(/^256[0-9]{9}$/.test(v))return '+'+v;
    return v? '+'+v : '';
  };
  const waLink=(phone,text)=>{
    const normalized=normalizePhone(phone),digits=normalized.replace(/^\+/,'');
    return /^[1-9][0-9]{7,14}$/.test(digits)?'https://wa.me/'+digits+'?text='+encodeURIComponent(text):'';
  };
  $('#ordersTable').innerHTML='<table><tr><th>Order</th><th>Customer</th><th>Fulfillment</th><th>Overall</th><th>Station Progress</th><th>Payment</th><th>Total</th><th>Actions</th></tr>'+
    rows.map(r=>{
      const method=String(r.fulfillment_method||'pickup').toLowerCase(),customerName=r.customers?.name||'',phone=String(r.customers?.phone||'').trim();
      const station=stationRows(r.id);
      const stationHtml=station.length?station.map(s=>{
        const name=s.service_stations?.name||'Station',label=s.status==='waiting'?'Waiting':s.status==='accepted'?'Accepted':s.status==='in_progress'?'In Progress':s.status==='cancelled'?'Cancelled':'Complete'; const stationNote=s.status==='cancelled'&&s.cancellation_reason?'<small class="muted">Reason: '+esc(s.cancellation_reason)+'</small>':'';
        const canOperateStation=(profile?.role==='owner'||profile?.role==='manager'||profile?.role==='general_manager'||profile?.role==='ceo'||profile?.role==='reception_manager'||(profile?.role==='chef'&&name==='Kitchen')||(profile?.role==='barista'&&name==='Barista'));
        const stationAction=(canOperateStation && (r.status==='pending'||r.status==='open'||r.status==='confirmed'))?
          '<select data-station-status="'+r.id+'" data-station-id="'+s.station_id+'"><option value="waiting" '+(s.status==='waiting'?'selected':'')+'>Waiting</option><option value="accepted" '+(s.status==='accepted'?'selected':'')+'>Accepted</option><option value="in_progress" '+(s.status==='in_progress'?'selected':'')+'>In Progress</option><option value="complete" '+(s.status==='complete'?'selected':'')+'>Complete</option><option value="cancelled" '+(s.status==='cancelled'?'selected':'')+'>Cancelled</option></select>'+
          ((s.status!=='complete'&&s.status!=='cancelled'&&(profile?.role==='chef'||profile?.role==='barista'))?'<button type="button" class="btn danger" data-station-cancel="'+r.id+'" data-station-id="'+s.station_id+'">Cancel</button>':'')
          :'<span class="pill">'+esc(s.status==='accepted'?'Accepted':s.status==='cancelled'?'Cancelled':label)+'</span>';
        return '<div style="display:flex;gap:8px;align-items:center;margin:3px 0;flex-wrap:wrap"><span>'+esc(name)+'</span>'+stationAction+stationNote+'</div>';
      }).join(''):'<span class="muted">Waiting</span>';
      const allComplete=station.length>0&&station.every(s=>s.status==='complete');
      const confirmText='Hello '+customerName+', your order has been confirmed by Kiteezi Recreational Center. Your order is now being prepared.';
      const readyText=method==='delivery'?'Hello '+customerName+', your order is completed and ready for delivery.':method==='dine_in'?'Hello '+customerName+', your order is completed and ready. Please proceed for dine-in.':'Hello '+customerName+', your order is completed and ready for pickup at Kiteezi Recreational Center.';
      const confirmBtn=hasPermission('orders.confirm')&&(r.status==='pending'||r.status==='open')?'<button class="btn" data-confirm-wa="'+r.id+'" data-wa="'+esc(phone)+'" data-watext="'+esc(confirmText)+'">Confirm</button> ':'';
      const completeBtn=(r.status==='confirmed'&&canGlobalComplete&&(!station.length||allComplete))?'<button class="btn" data-done-wa="'+r.id+'" data-wa="'+esc(phone)+'" data-watext="'+esc(readyText)+'">Complete</button> ':'';
      const paidBtn=hasPermission('orders.pay')&&(r.status!=='cancelled'&&r.payment_status!=='paid')?'<button class="btn" data-paid="'+r.id+'">Paid</button> ':'';
      const cancelBtn=hasPermission('orders.cancel')&&(r.status!=='completed'&&r.status!=='cancelled')?'<button class="btn" data-admin-cancel="'+r.id+'" data-customer="'+esc(customerName)+'" data-phone="'+esc(phone)+'">Cancel</button> ':'';
      const itemsBtn='<button class="btn" data-items="'+r.id+'">Items</button> <button class="btn" data-receipt="'+r.id+'">Receipt</button> ';
      const deleteBtn=profile?.role==='owner'?'<button class="btn danger" data-delete-order="'+r.id+'">Delete</button>':'';
      return '<tr data-items="'+r.id+'"><td>#'+esc(r.id.slice(0,8).toUpperCase())+'<br>'+esc(r.source)+'</td><td>'+esc(customerName)+'<br>'+esc(phone)+'</td><td>'+esc(method==='delivery'?'Delivery':method==='dine_in'?'Dine in':'Pickup from Kiteezi')+'</td><td>'+esc(r.status==='pending'||r.status==='open'?'Waiting for Confirmation':r.status==='confirmed'?'In Progress':r.status==='completed'?'Complete':r.status)+'</td><td>'+stationHtml+'</td><td>'+esc(r.payment_status)+'</td><td>UGX '+money(r.total)+'</td><td class="actions">'+confirmBtn+completeBtn+paidBtn+cancelBtn+itemsBtn+deleteBtn+'</td></tr>';
    }).join('')+'</table>';
  document.querySelectorAll('[data-confirm-wa]').forEach(x=>x.onclick=()=>confirmOrderWithCocktailChoice(x.dataset.confirmWa,'confirmed',null,x.dataset.wa,x.dataset.watext));
  document.querySelectorAll('[data-paid]').forEach(x=>x.onclick=()=>setOrder(x.dataset.paid,null,'paid'));
  document.querySelectorAll('[data-done-wa]').forEach(x=>x.onclick=()=>setOrderAndWhatsApp(x.dataset.doneWa,'completed',null,x.dataset.wa,x.dataset.watext));
  document.querySelectorAll('[data-station-status]').forEach(x=>x.onchange=async()=>{
    const orderId=x.dataset.stationStatus;
    const newStatus=x.value;
    try{
      await api('/rest/v1/rpc/set_order_station_status',{method:'POST',body:JSON.stringify({p_order_id:orderId,p_station_id:x.dataset.stationId,p_status:newStatus})});
      const fresh=await api('/rest/v1/orders?select=id,status,fulfillment_method,customers(name,phone)&id=eq.'+encodeURIComponent(orderId)+'&limit=1');
      await loadOrders();
      const order=fresh?.[0];
      if(newStatus==='complete' && order?.status==='completed'){
        const customer=order.customers?.name||'Customer',phone=String(order.customers?.phone||'').replace(/\D/g,'');
        const canonical=/^07[0-9]{8}$/.test(phone)?'256'+phone.slice(1):/^7[0-9]{8}$/.test(phone)?'256'+phone:/^256[0-9]{9}$/.test(phone)?phone:'';
        if(canonical){
          const method=String(order.fulfillment_method||'pickup').toLowerCase();
          const textMessage=method==='delivery'?'Hello '+customer+', your order is completed and ready for delivery.':method==='dine_in'?'Hello '+customer+', your order is completed and ready. Please proceed for dine-in.':'Hello '+customer+', your order is completed and ready for pickup at Kiteezi Recreational Center.';
          window.location.href='https://wa.me/'+canonical+'?text='+encodeURIComponent(textMessage);
        }
      }
    }catch(e){msg(e);await loadOrders();}
  });
  document.querySelectorAll('[data-admin-cancel]').forEach(x=>x.onclick=()=>adminCancelOrder(x.dataset.adminCancel,x.dataset.customer,x.dataset.phone));
  document.querySelectorAll('[data-items]').forEach(x=>x.onclick=()=>loadOrderItems(x.dataset.items));document.querySelectorAll('[data-receipt]').forEach(x=>x.onclick=()=>printOrderReceipt(x.dataset.receipt).catch(msg));
  document.querySelectorAll('[data-delete-order]').forEach(x=>x.onclick=()=>deleteTestRecord('order',x.dataset.deleteOrder));
}
async function setOrder(id,status,payment){
  await api('/rest/v1/rpc/admin_set_order_status',{method:'POST',body:JSON.stringify({p_order_id:id,p_status:status,p_payment_status:payment})});
  await loadOrders();
}
async function confirmOrderWithCocktailChoice(id,status,payment,phone,textMessage){
  try{
    const items=await api('/rest/v1/order_items?select=id,qty,menu_item_id,menu_items(name)&order_id=eq.'+encodeURIComponent(id));
    const cocktailIds=[...new Set(items.map(x=>x.menu_item_id))];
    const rules=cocktailIds.length?await api('/rest/v1/shared_pool_menu_rules?select=menu_item_id&menu_item_id=in.('+cocktailIds.join(',')+')&requires_components=eq.true&active=eq.true'):[];
    const cocktailItemIds=new Set((rules||[]).map(x=>x.menu_item_id));
    const cocktailItems=items.filter(x=>cocktailItemIds.has(x.menu_item_id));
    if(!cocktailItems.length){
      return setOrderAndWhatsApp(id,status,payment,phone,textMessage);
    }
    const fruits=await api('/rest/v1/inventory_items?select=id,name,unit&name=in.(Orange,Lemon,Pineapple,"Passion fruit",Beetroot,Watermelon,Mango)&active=eq.true&order=name.asc');
    if(!fruits.length)throw new Error('No cocktail fruit inventory items are available. Add at least one cocktail fruit before confirming.');
    const checks=fruits.map(x=>'<label style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #eee"><input type="checkbox" name="cocktailFruit" value="'+x.id+'"><span><strong>'+esc(x.name)+'</strong><small class="muted" style="display:block">'+esc(x.unit||'')+'</small></span></label>').join('');
    const names=cocktailItems.map(x=>esc(x.menu_items?.name||'Cocktail')).join(', ');
    modal('Choose cocktail fruit','<form id="cocktailConfirmForm" class="form"><p><strong>'+names+'</strong></p><p class="muted">Choose the fruit(s) that will be used for this cocktail. <strong>At least one fruit is required.</strong> You can select more than one.</p><div>'+checks+'</div><button class="btn btn-dark" type="submit">Confirm Order</button></form>');
    $('#cocktailConfirmForm').onsubmit=async e=>{
      e.preventDefault();
      const selected=[...e.currentTarget.querySelectorAll('input[name="cocktailFruit"]:checked')].map(x=>x.value);
      if(!selected.length){alert('Select at least one cocktail fruit before confirming the order.');return;}
      const components=selected.map(inventory_item_id=>({inventory_item_id,dish_type:'cocktail_component'}));
      try{
        for(const item of cocktailItems){
          await api('/rest/v1/order_items?id=eq.'+encodeURIComponent(item.id),{method:'PATCH',body:JSON.stringify({shared_pool_components:components})});
        }
        closeModal();
        await setOrderAndWhatsApp(id,status,payment,phone,textMessage);
      }catch(err){msg(err);}
    };
  }catch(err){msg(err);}
}
async function setOrderAndWhatsApp(id,status,payment,phone,textMessage){
  const normalized=String(phone||'').trim().replace(/[^0-9+]/g,'').replace(/^00/,'+');
  let canonical=normalized;
  if(/^07[0-9]{8}$/.test(canonical))canonical='+256'+canonical.slice(1);
  else if(/^7[0-9]{8}$/.test(canonical))canonical='+256'+canonical;
  else if(/^256[0-9]{9}$/.test(canonical))canonical='+'+canonical;
  const digits=canonical.replace(/^\+/,'');
  try{
    await api('/rest/v1/rpc/admin_set_order_status',{method:'POST',body:JSON.stringify({p_order_id:id,p_status:status,p_payment_status:payment})});
    await loadOrders();
  }catch(err){msg(err);return}
  if(!/^[1-9][0-9]{7,14}$/.test(digits)){
    showAdminToast('Order updated','The order status was changed, but WhatsApp was not opened because the customer phone number is invalid.');
    return;
  }
  window.location.href='https://wa.me/'+digits+'?text='+encodeURIComponent(textMessage||'');
}
async function adminCancelOrder(id,customer,phone){
  const reasons=['Customer requested cancellation','Out of stock','Customer unreachable','Operational issue','Duplicate order','Other'];
  modal('Cancel order','<form id="adminCancelOrderForm" class="form"><p>Choose the mandatory cancellation reason.</p><select name="reason" required>'+reasons.map(x=>'<option>'+esc(x)+'</option>').join('')+'</select><label><input type="checkbox" name="whatsapp" checked> Open WhatsApp with the cancellation reason after cancelling</label><textarea name="message" rows="4">'+esc('Hello '+customer+', your Kiteezi Recreational Center order has been cancelled. Reason: '+reasons[0]+'.')+'</textarea><button class="btn btn-dark" type="submit">Cancel Order</button></form>');
  const form=$('#adminCancelOrderForm');
  form.querySelector('[name=reason]').onchange=()=>{const r=form.querySelector('[name=reason]').value;form.querySelector('[name=message]').value='Hello '+customer+', your Kiteezi Recreational Center order has been cancelled. Reason: '+r+'.';};
  form.onsubmit=async e=>{e.preventDefault();const fd=new FormData(form),reason=String(fd.get('reason')||''),useWa=fd.get('whatsapp')==='on',messageText=String(fd.get('message')||'').trim();try{await api('/rest/v1/rpc/admin_cancel_order',{method:'POST',body:JSON.stringify({p_order_id:id,p_reason:reason})});closeModal();await loadOrders();if(useWa){const digits=String(phone||'').replace(/\D/g,'');const canonical=/^07[0-9]{8}$/.test(digits)?'256'+digits.slice(1):/^7[0-9]{8}$/.test(digits)?'256'+digits:/^256[0-9]{9}$/.test(digits)?digits:'';if(canonical)window.location.href='https://wa.me/'+canonical+'?text='+encodeURIComponent(messageText);else alert('Order cancelled. WhatsApp was not opened because the customer phone number is not a valid international number.');}}catch(err){msg(err);}};
  $('#modal').classList.add('open');
}
async function printOrderReceipt(id){const [orders,items,settings]=await Promise.all([api('/rest/v1/orders?select=*,customers(name,phone)&id=eq.'+encodeURIComponent(id)+'&limit=1'),api('/rest/v1/order_items?select=qty,unit_price,item_name_snapshot,notes,menu_items(name)&order_id=eq.'+encodeURIComponent(id)+'&order=id'),api('/rest/v1/site_settings?select=key,value&key=in.(business_name,phone,logo_url)')]);const order=orders?.[0];if(!order)throw Error('Order not found.');const cfg=Object.fromEntries((settings||[]).map(x=>[x.key,x.value||'']));const logo=cfg.logo_url||'';const rows=(items||[]).map(x=>{const qty=Number(x.qty)||0,unit=Number(x.unit_price)||0;return '<tr><td>'+esc(x.item_name_snapshot||x.menu_items?.name||'Item')+'</td><td>'+qty+'</td><td>UGX '+money(unit)+'</td><td>UGX '+money(qty*unit)+'</td></tr>'}).join('');const w=window.open('','_blank','width=760,height=900');if(!w)throw Error('Please allow pop-ups to print the receipt.');w.document.write('<!doctype html><html><head><title>Receipt '+esc(id.slice(0,8).toUpperCase())+'</title><style>body{font:14px Arial,sans-serif;color:#17231c;margin:0;padding:28px;background:#fff}.receipt{max-width:680px;margin:auto;border:1px solid #dfe6e1;border-radius:16px;padding:28px}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #17231c;padding-bottom:18px}.logo{max-width:180px;max-height:80px;object-fit:contain}.meta{text-align:right}.muted{color:#68756d}.items{width:100%;border-collapse:collapse;margin-top:24px}.items th,.items td{padding:10px 6px;border-bottom:1px solid #e5e9e6;text-align:left}.items th:nth-child(n+2),.items td:nth-child(n+2){text-align:right}.total{margin-top:18px;text-align:right;font-size:20px;font-weight:800}.foot{margin-top:26px;padding-top:14px;border-top:1px solid #e5e9e6;text-align:center}.actions{margin-top:20px;text-align:center}@media print{body{padding:0}.receipt{border:0;border-radius:0;max-width:none;padding:12px}.actions{display:none}}</style></head><body><div class="receipt"><div class="head"><div>'+ (logo?'<img class="logo" src="'+esc(logo)+'" alt="Kiteezi Recreational Center">':'<h2>Kiteezi Recreational Center</h2>') +'</div><div class="meta"><strong>RECEIPT</strong><br>#'+esc(id.slice(0,8).toUpperCase())+'<br><span class="muted">'+esc(order.created_at||'')+'</span></div></div><p><strong>Customer:</strong> '+esc(order.customers?.name||'Walk-in customer')+'<br><strong>Phone:</strong> '+esc(order.customers?.phone||'')+'<br><strong>Payment:</strong> '+esc(order.payment_status||'unpaid')+'<br><strong>Fulfillment:</strong> '+esc(order.fulfillment_method||'pickup')+'</p><table class="items"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead><tbody>'+rows+'</tbody></table><div class="total">TOTAL: UGX '+money(order.total)+'</div><div class="foot">'+esc(cfg.business_name||'Kiteezi Recreational Center')+'<br>'+esc(cfg.phone||'')+'<br>Thank you for choosing Kiteezi.</div><div class="actions"><button onclick="window.print()">Print / Save PDF</button></div></div></body></html>');w.document.close();w.focus();setTimeout(()=>w.print(),250);}
async function loadOrderItems(id){let r=await api('/rest/v1/order_items?select=id,qty,unit_price,item_name_snapshot,notes,menu_items(name,station_id,service_stations(name))&order_id=eq.'+id);if(['barista','chef'].includes(profile?.role)){const target=profile.role==='barista'?'Barista':'Kitchen';r=r.filter(x=>(x.menu_items?.service_stations?.name||'')===target)}$('#orderItemsTable').innerHTML='<table><tr><th>Item</th><th>Station</th><th>Qty</th><th>Price</th><th>Notes</th></tr>'+r.map(x=>'<tr><td>'+esc(x.item_name_snapshot||x.menu_items?.name||'')+'</td><td><span class="pill">'+esc(x.menu_items?.service_stations?.name||'Unassigned')+'</span></td><td>'+x.qty+'</td><td>UGX '+money(x.unit_price)+'</td><td>'+esc(x.notes||'')+'</td></tr>').join('')+'</table>'}

async function loadRecipeMappings(){
  const box=$('#recipeTable'); if(!box)return;
  const recipeManage=hasPermission('recipes.manage');
  const toolbar='<div class="toolbar">'+(recipeManage?'<button class="btn" id="newRecipe">Add recipe</button>':'')+'<button class="btn btn-dark" id="refreshRecipes">Refresh</button></div>';
  box.innerHTML=toolbar+'<div class="state">Loading recipes…</div>';
  const wire=()=>{$('#newRecipe').onclick=()=>manageRecipe();$('#refreshRecipes').onclick=()=>loadRecipeMappings().catch(msg)};
  wire();
  try{
    const [recipes,shared]=await Promise.all([
      api('/rest/v1/menu_item_recipes?select=id,menu_item_id,inventory_item_id,quantity,recipe_unit,stock_units_per_recipe_unit,menu_items(name,serving_unit,service_stations(name)),inventory_items(name,unit)&order=created_at.asc'),
      api('/rest/v1/shared_pool_menu_rules?select=id,menu_item_id,inventory_item_id,dish_type,fraction_per_menu_unit,allocation_profile,requires_components,requires_profile,active,notes,menu_items(name,serving_unit,service_stations(name)),inventory_items(name,unit)&active=eq.true&order=menu_item_id.asc')
    ]);
    let direct=Array.isArray(recipes)?recipes:[], pool=Array.isArray(shared)?shared:[];
    const recipeStation=({barista:'Barista',bartender:'Barista',chef:'Kitchen',head_chef:'Kitchen'})[profile?.role];
    if(recipeStation){
      direct=direct.filter(r=>(r.menu_items?.service_stations?.name||'')===recipeStation);
      pool=pool.filter(r=>(r.menu_items?.service_stations?.name||'')===recipeStation);
    }
    const directHtml=direct.length
      ?'<h3>Direct recipes</h3><table><tr><th>Menu item</th><th>Station</th><th>Ingredient</th><th>Recipe amount</th><th>Stock conversion</th><th></th></tr>'+
        direct.map(r=>'<tr><td>'+esc(r.menu_items?.name||r.menu_item_id)+'<br><small>'+esc(r.menu_items?.serving_unit||'')+'</small></td><td><span class="pill">'+esc(r.menu_items?.service_stations?.name||'Unassigned')+'</span></td><td>'+esc(r.inventory_items?.name||r.inventory_item_id)+' ('+esc(r.inventory_items?.unit||'')+')</td><td>'+esc(r.quantity)+' '+esc(r.recipe_unit||'stock')+'</td><td>'+esc(r.stock_units_per_recipe_unit||1)+' stock unit / recipe unit</td><td><button class="btn" data-recipe-edit="'+r.id+'">Edit</button> <button class="btn danger" data-recipe-delete="'+r.id+'">Delete</button></td></tr>').join('')+'</table>'
      :'<h3>Direct recipes</h3><div class="state">No direct recipe rows.</div>';
    const poolHtml=pool.length
      ?'<h3 style="margin-top:28px">Shared inventory &amp; automatic allocation rules</h3><p class="muted">These are production rules, not separate physical stock. Multiple menu items can draw from the same inventory pool.</p><table><tr><th>Menu item</th><th>Shared inventory</th><th>Rule</th><th>Allocation</th><th>Profile / components</th></tr>'+
        pool.map(r=>'<tr><td>'+esc(r.menu_items?.name||r.menu_item_id)+'<br><small>'+esc(r.menu_items?.serving_unit||'')+'</small></td><td>'+esc(r.inventory_items?.name||r.inventory_item_id)+' ('+esc(r.inventory_items?.unit||'')+')</td><td>'+esc(r.dish_type||'Shared pool')+'</td><td>'+esc(r.fraction_per_menu_unit==null?'Dynamic / supplied at order time':r.fraction_per_menu_unit)+' '+esc(r.fraction_per_menu_unit==null?'':'pool unit per menu unit')+'</td><td>'+esc(r.allocation_profile||'—')+(r.requires_components?' · components required':'')+(r.requires_profile?' · profile required':'')+'<br><small>'+esc(r.notes||'')+'</small></td></tr>').join('')+'</table>'
      :'<h3 style="margin-top:28px">Shared inventory &amp; automatic allocation rules</h3><div class="state">No shared-pool rules found.</div>';
    box.innerHTML=toolbar+directHtml+poolHtml;
    wire();
    $$('[data-recipe-edit]').forEach(x=>x.onclick=()=>manageRecipe(x.dataset.recipeEdit));
    $$('[data-recipe-delete]').forEach(x=>x.onclick=async()=>{if(!confirm('Delete this recipe ingredient?'))return;try{await api('/rest/v1/menu_item_recipes?id=eq.'+encodeURIComponent(x.dataset.recipeDelete),{method:'DELETE'});await loadRecipeMappings()}catch(e){msg(e)}});
  }catch(e){
    box.innerHTML=toolbar+'<div class="state">Recipes could not be loaded. Please refresh and try again.</div>';
    wire();
  }
}
async function loadDailyStock(){const d=$('#stockRunDate').value||today();$('#stockRunDate').value=d;const [itemsAll,movs,counts,before]=await Promise.all([api('/rest/v1/inventory_items?select=id,name,unit,inventory_scope&active=eq.true&order=name.asc'),api('/rest/v1/stock_movements?select=item_id,quantity,movement_type,reason,created_at&created_at=gte.'+d+'T00:00:00&created_at=lte.'+d+'T23:59:59'),api('/rest/v1/inventory_daily_counts?select=inventory_item_id,physical_quantity&count_date=eq.'+d),api('/rest/v1/stock_movements?select=item_id,quantity,movement_type&created_at=lt.'+d+'T00:00:00')]);const scopeForRole={chef:'kitchen',head_chef:'kitchen',barista:'bar',bartender:'bar',grounds_cleaning:'cleaning',head_swimming_coach:'swimming',swimming_coach:'swimming',waitstaff:'service'}[profile?.role];const items=scopeForRole?itemsAll.filter(x=>x.inventory_scope===scopeForRole):itemsAll;const opening={};before.forEach(x=>opening[x.item_id]=(opening[x.item_id]||0)+(String(x.movement_type).toLowerCase()==='out'?-1:1)*Number(x.quantity||0));const day={};movs.forEach(x=>{const z=day[x.item_id]||{added:0,pos:0,waste:0,owner:0,other:0};const q=Number(x.quantity||0),r=String(x.reason||'').toLowerCase();if(String(x.movement_type).toLowerCase()!=='out')z.added+=q;else if(r.startsWith('order '))z.pos+=q;else if(r==='waste')z.waste+=q;else if(r==='owner taken home')z.owner+=q;else z.other+=q;day[x.item_id]=z});const counted=Object.fromEntries(counts.map(x=>[x.inventory_item_id,Number(x.physical_quantity)]));$('#dailyStockTable').innerHTML='<table><tr><th>Item</th><th>Opening</th><th>Added</th><th>POS Used</th><th>Waste</th><th>Owner Home</th><th>Other</th><th>Expected</th><th>Physical</th><th>Variance</th></tr>'+items.map(x=>{const z=day[x.id]||{added:0,pos:0,waste:0,owner:0,other:0},op=Number(opening[x.id]||0),expected=op+z.added-z.pos-z.waste-z.owner-z.other,p=counted[x.id];return '<tr><td>'+esc(x.name)+'<br><small>'+esc(x.unit)+'</small></td><td>'+op+'</td><td>'+z.added+'</td><td>'+z.pos+'</td><td>'+z.waste+'</td><td>'+z.owner+'</td><td>'+z.other+'</td><td>'+expected+'</td><td>'+(p==null?'—':p)+'</td><td>'+(p==null?'—':p-expected)+'</td></tr>'}).join('')+'</table>'}
async function loadPurchases(){
  if(!(hasPermission('purchase_orders.view')||hasPermission('purchase_orders.manage'))){setHTML('#purchaseOrdersTable','<div class="state">Purchase receiving is not part of this account.</div>');return;}
  const orders=await api('/rest/v1/purchase_orders?select=*&order=created_at.desc');
  setHTML('#purchaseOrdersTable',orders.length?'<table><tr><th>PO</th><th>Supplier</th><th>Reference</th><th>Status</th><th>Received</th><th>Paid</th><th>Total</th><th>Actions</th></tr>'+
    orders.map(o=>'<tr><td>'+esc(o.po_number||o.id.slice(0,8).toUpperCase())+'</td><td>'+esc(o.supplier||'')+'</td><td>'+esc(o.reference||'')+'</td><td>'+esc(o.status||'ordered')+'</td><td>'+esc(['received','partially_received'].includes(String(o.status))?'Yes':'No')+'</td><td>'+esc(o.payment_status||'unpaid')+'</td><td>UGX '+money(o.total)+'</td><td class="actions">'+
    (o.status!=='received'&&o.status!=='cancelled'?'<button class="btn" data-receive-po="'+o.id+'">Receive</button> ':'')+
    (String(o.payment_status||'unpaid')!=='paid'&&o.status!=='cancelled'?'<button class="btn" data-paid-po="'+o.id+'">Mark paid</button> ':'')+
    (profile?.role==='owner'?'<button class="btn danger" data-delete-po="'+o.id+'">Delete</button>':'')+
    '</td></tr>').join('')+'</table>':'<div class="state">No generated purchase orders yet.</div>');
  $$('[data-receive-po]').forEach(x=>x.onclick=()=>receivePurchase(x.dataset.receivePo));
  $$('[data-paid-po]').forEach(x=>x.onclick=async e=>{try{await api('/rest/v1/rpc/mark_purchase_order_paid',{method:'POST',body:JSON.stringify({p_purchase_order_id:e.currentTarget.dataset.paidPo})});await loadPurchases();}catch(err){msg(err)}});
  $$('[data-delete-po]').forEach(x=>x.onclick=()=>deleteTestRecord('purchase_order',x.dataset.deletePo));
}
async function receivePurchase(id){
  const items=await api('/rest/v1/purchase_order_items?select=*,inventory_items(name,unit)&purchase_order_id=eq.'+encodeURIComponent(id));
  if(!items.length){alert('This purchase order has no line items.');return;}
  modal('Receive purchase','<form id="receive" class="form"><p class="muted">Enter the quantity actually received. Partial receipts are allowed.</p>'+
    items.map(i=>'<label>'+esc(i.inventory_items?.name||'')+' ('+esc(i.inventory_items?.unit||'')+')<input name="'+i.id+'" type="number" step="0.001" min="0" max="'+Math.max(0,Number(i.ordered_quantity)-Number(i.received_quantity||0))+'" value="'+Math.max(0,Number(i.ordered_quantity)-Number(i.received_quantity||0))+'"></label>').join('')+
    '<button class="btn btn-dark">Record receipt</button></form>');
  const form=$('#receive'); if(!form)return;
  form.onsubmit=async e=>{
    e.preventDefault(); const fd=new FormData(form);
    const received=items.map(i=>({purchase_order_item_id:i.id,quantity:Number(fd.get(i.id)||0)})).filter(x=>x.quantity>0);
    if(!received.length){alert('Enter at least one received quantity.');return;}
    try{
      await api('/rest/v1/rpc/receive_purchase_order',{method:'POST',body:JSON.stringify({p_purchase_order_id:id,p_items:received})});
      closeModal(); await loadPurchases(); await loadDailyStock(); await loadInventory();
    }catch(err){msg(err);}
  };
}
async function setOpeningStock(){const inv=await api('/rest/v1/inventory_items?select=id,name,unit&active=eq.true&order=name.asc');modal('Set opening stock','<form id="openingStockForm" class="form"><p class="muted">Enter the stock physically available when Kiteezi starts its inventory records. This creates auditable opening-balance movements.</p>'+inv.map(x=>'<label>'+esc(x.name)+' ('+esc(x.unit)+')<input name="'+x.id+'" type="number" step="0.001" min="0" placeholder="Opening quantity"></label>').join('')+'<button class="btn btn-dark">Save opening stock</button></form>');$('#openingStockForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const rows=inv.map(x=>({item_id:x.id,quantity:Number(f.get(x.id)||0)})).filter(x=>x.quantity>0);if(!rows.length)return alert('Enter at least one opening quantity.');for(const x of rows){await api('/rest/v1/stock_movements',{method:'POST',body:JSON.stringify({item_id:x.item_id,quantity:x.quantity,movement_type:'in',reason:'Opening Balance',staff_id:session.user.id})})}closeModal();loadInventory();loadDailyStock()}}
async function addStockAdjustment(){
  const scopeForRole={chef:'kitchen',head_chef:'kitchen',barista:'bar',bartender:'bar',grounds_cleaning:'cleaning',head_swimming_coach:'swimming',swimming_coach:'swimming',waitstaff:'service'}[profile?.role];
  const inv=await api('/rest/v1/inventory_items?select=id,name,unit,inventory_scope&active=eq.true&order=name.asc');
  const scoped=scopeForRole?inv.filter(x=>x.inventory_scope===scopeForRole):inv;const ownerOnly=String(profile?.role||'').toLowerCase()==='owner';const homeOption=ownerOnly?'<option>Owner Taken Home</option>':'';modal('Add stock movement','<form id="adj" class="form"><select name="item">'+scoped.map(x=>'<option value="'+x.id+'">'+esc(x.name)+' ('+esc(x.unit)+')</option>').join('')+'</select><select name="type"><option value="out">Stock out</option><option value="in">Stock in</option></select><select name="reason"><option>Waste</option>'+homeOption+'<option>Other Adjustment</option></select><input name="qty" type="number" step="0.001" min="0.001" placeholder="Quantity" required><textarea name="notes" placeholder="Notes"></textarea><button class="btn btn-dark">Save movement</button></form>');$('#adj').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/rest/v1/stock_movements',{method:'POST',body:JSON.stringify({item_id:f.get('item'),quantity:Number(f.get('qty')),movement_type:f.get('type'),reason:f.get('reason')+(f.get('notes')?' — '+f.get('notes'):''),staff_id:session.user.id})});closeModal();loadInventory()}}
async function loadStockMovements(){
  const scopeForRole={chef:'kitchen',barista:'bar',grounds_cleaning:'cleaning',head_swimming_coach:'swimming'}[profile?.role];
  const r=await api('/rest/v1/stock_movements?select=*,inventory_items(name,unit,inventory_scope)&order=created_at.desc&limit=100');
  const visibleRows=scopeForRole?r.filter(x=>x.inventory_items?.inventory_scope===scopeForRole):r;
  const owner=profile?.role==='owner';
  $('#stockMovementTable').innerHTML=visibleRows.length
    ?'<table><tr><th>Date</th><th>Item</th><th>Movement</th><th>Qty</th><th>Reason</th><th></th></tr>'+
      visibleRows.map(x=>'<tr><td>'+esc(x.created_at?.slice(0,16)||'')+'</td><td>'+esc(x.inventory_items?.name||x.item_id)+'</td><td>'+esc(x.movement_type)+'</td><td>'+esc(x.quantity)+'</td><td>'+esc(x.reason||'')+'</td><td>'+(owner?'<button class="btn danger" data-delete-movement="'+x.id+'">Delete</button>':'')+'</td></tr>').join('')+
      '</table>'
    :'<div class="state">No stock movements yet.</div>';
  if(owner) $$('[data-delete-movement]').forEach(b=>b.onclick=()=>deleteTestRecord('stock_movement',b.dataset.deleteMovement));
}
async function loadInventory(){
  const box=$('#inventoryTable'); if(!box)return;
  box.innerHTML='<div class="state">Loading inventory…</div>';
  try{
    /*
      inventory_stock calculates current stock in Postgres. The old client
      downloaded the entire stock_movements table and calculated every
      item's balance in the browser, which gets slower as history grows.
    */
    const rows=await api('/rest/v1/inventory_stock?select=id,name,unit,category,reorder_level,active,station_id,inventory_scope,station_name,current_stock&order=name.asc');
    const scopeForRole={chef:'kitchen',barista:'bar',grounds_cleaning:'cleaning',head_swimming_coach:'swimming'}[profile?.role];
    const rows0=scopeForRole?rows.filter(x=>x?.inventory_scope===scopeForRole):rows;
    const low=rows0.filter(x=>Number(x.current_stock||0)<5);
    box.innerHTML=(low.length?'<div class="low-stock-banner"><strong>Low inventory: '+low.length+' item(s)</strong><span>'+low.map(x=>esc(x.name)+' ('+esc(Number(x.current_stock||0))+' '+esc(x.unit||'units')+')').join(', ')+'</span></div>':'')+(rows0.length?'<table><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th>Station</th><th>Stock</th><th>Reorder</th><th>Active</th><th></th></tr></thead><tbody>'+
      rows0.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.category||'')+'</td><td>'+esc(x.unit||'')+'</td><td><span class="pill">'+esc(x.station_name||'Unassigned')+'</span></td><td>'+esc(x.current_stock??0)+'</td><td>'+esc(x.reorder_level??0)+'</td><td>'+esc(x.active?'Yes':'No')+'</td><td>'+(hasPermission('inventory.manage')?'<button class="btn" data-edit-inv="'+x.id+'">Edit</button> ':'')+(profile?.role==='owner'?'<button class="btn danger" data-delete-inv="'+x.id+'">Delete</button>':'')+'</td></tr>').join('')+
      '</tbody></table>':'<div class="state">No inventory items found.</div>');
    Array.from(document.querySelectorAll('[data-edit-inv]')).forEach(x=>x.onclick=()=>editInventory(x.dataset.editInv));
    Array.from(document.querySelectorAll('[data-delete-inv]')).forEach(x=>x.onclick=()=>deleteBusinessRecord('inventory_item',x.dataset.deleteInv,loadInventory));
  }catch(e){
    console.error('Inventory load failed:',e);
    box.innerHTML='<div class="state">Inventory is temporarily unavailable.</div>';
  }
}
async function editInventory(id=null){
  const [stations]=await Promise.all([api('/rest/v1/service_stations?select=id,name&active=eq.true&order=sort_order.asc'),loadUnitOptions()]);
  const roleScope={chef:'kitchen',barista:'bar',grounds_cleaning:'cleaning',head_swimming_coach:'swimming'}[profile?.role]||'operational';
  const restricted=['chef','barista','grounds_cleaning','head_swimming_coach'].includes(profile?.role);
  const x=id?(await api('/rest/v1/inventory_items?id=eq.'+id))[0]:{name:'',unit:'',category:'',reorder_level:0,active:true,station_id:null,inventory_scope:roleScope};
  const allowedScopes=['owner','ceo','general_manager','manager'].includes(profile?.role)?['operational','kitchen','bar','cleaning','swimming','facility']:[roleScope];
  const stationOptions=stations.filter(st=>profile?.role==='chef'?st.name==='Kitchen':profile?.role==='barista'?st.name==='Barista':true);
  modal(id?'Inventory item':'Add inventory item','<form id="inv" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Ingredient / stock item name" required><select name="unit" required>'+unitOptionsHtml(x.unit)+'</select><select name="station"><option value="">No production station</option>'+stationOptions.map(q=>'<option value="'+q.id+'" '+(x.station_id===q.id?'selected':'')+'>'+esc(q.name)+'</option>').join('')+'</select><select name="scope" '+(restricted?'disabled':'')+'>'+allowedScopes.map(sc=>'<option value="'+sc+'" '+((x.inventory_scope||roleScope)===sc?'selected':'')+'>'+esc(sc)+'</option>').join('')+'</select><input name="category" value="'+esc(x.category||'')+'" placeholder="Category">'+(!id?'<input name="opening_quantity" type="number" min="0" step="0.001" value="0" placeholder="Opening quantity (optional)">':'')+'<input name="reorder" type="number" step="0.001" value="'+(x.reorder_level||0)+'" placeholder="Reorder level"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');
  $('#inv').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),scope=restricted?roleScope:String(f.get('scope')||roleScope),body={name:f.get('name'),unit:f.get('unit'),station_id:f.get('station')||null,inventory_scope:scope,category:f.get('category')||null,reorder_level:Number(f.get('reorder')||0),active:f.get('active')==='on'};try{const saved=await api(id?'/rest/v1/inventory_items?id=eq.'+id:'/rest/v1/inventory_items',{method:id?'PATCH':'POST',body:JSON.stringify(body)});if(!id){const created=Array.isArray(saved)?saved[0]:saved;const opening=Number(f.get('opening_quantity')||0);if(created?.id&&opening>0){await api('/rest/v1/stock_movements',{method:'POST',body:JSON.stringify({item_id:created.id,quantity:opening,movement_type:'in',reason:'Initial stock received',staff_id:session.user.id})});}}closeModal();loadInventory();loadDailyStock()}catch(err){msg(err)}}
}
async function manageRecipe(existingId=null){
  try{
    const [m,i,u]=await Promise.all([
      api('/rest/v1/menu_items?select=id,name,serving_unit,station_id,service_stations(name)&order=name.asc'),
      api('/rest/v1/inventory_items?select=id,name,unit,station_id,service_stations(name)&active=eq.true&order=name.asc'),
      api('/rest/v1/inventory_unit_conversions?select=id,inventory_item_id,serving_unit,stock_unit,stock_units_per_serving,active&active=eq.true&order=serving_unit.asc')
    ]);
    if(!m.length)throw Error('No menu items exist yet. Add the menu item first.');
    if(!i.length)throw Error('No active inventory ingredients exist yet. Add an inventory item first.');
    let existing=null;
    if(existingId){
      existing=(await api('/rest/v1/menu_item_recipes?id=eq.'+encodeURIComponent(existingId)+'&limit=1'))?.[0];
      if(!existing)throw Error('The recipe ingredient could not be found.');
    }
    const menuOptions=m.map(x=>'<option value="'+x.id+'" '+(existing?.menu_item_id===x.id?'selected':'')+'>'+esc(x.name)+' — '+esc(x.service_stations?.name||'Unassigned')+'</option>').join('');
    const conversions=Array.isArray(u)?u:[];
    const row=(inv='',qty='',unit='stock',factor='1',conversionId='')=>'<div class="recipe-row" style="display:grid;grid-template-columns:minmax(0,1fr) 110px 120px 150px auto;gap:8px;align-items:end;margin-bottom:8px">'+
      '<label>Ingredient<select class="recipe-inv" required>'+i.map(x=>'<option value="'+x.id+'" '+(inv===x.id?'selected':'')+'>'+esc(x.name)+' ('+esc(x.unit)+')</option>').join('')+'</select></label>'+
      '<label>Amount<input class="recipe-qty" type="number" step="0.001" min="0.001" value="'+esc(qty)+'" placeholder="1" required></label>'+
      '<label>Recipe unit<select class="recipe-unit" required>'+unitOptionsHtml(unit)+'</select></label>'+
      '<label>Conversion<select class="recipe-conversion"><option value="">No conversion</option>'+conversions.filter(cv=>!inv||cv.inventory_item_id===inv).map(cv=>'<option value="'+cv.id+'" '+(cv.id===conversionId?'selected':'')+'>'+esc(cv.serving_unit)+' → '+esc(cv.stock_unit)+' ('+esc(cv.stock_units_per_serving)+')</option>').join('')+'</select></label>'+
      '<button type="button" class="btn recipe-remove">Remove</button></div>';
    modal(existing?'Edit recipe ingredient':'Build recipe',
      '<form id="recipe" class="form"><label>Menu item<select name="menu" required>'+menuOptions+'</select></label>'+
      (existing?row(existing.inventory_item_id,existing.quantity,existing.recipe_unit||'stock',existing.stock_units_per_recipe_unit||1,existing.conversion_id||''):'<div id="recipeRows">'+row()+'</div><button type="button" class="btn" id="addRecipeIngredient">+ Add another ingredient</button>')+
      '<p class="muted">Amount is for ONE menu serving. Recipe unit is the serving measurement. Stock conversion is how many inventory stock units one recipe unit consumes. Example: a 750 ml bottle sold as a 30 ml shot = 1/25 bottle per shot.</p>'+
      '<div id="recipeError" class="state" style="display:none"></div><button class="btn btn-dark" type="submit">'+(existing?'Save recipe ingredient':'Save recipe')+'</button></form>');
    const bindRemove=()=>$$('.recipe-remove',$('#recipe')).forEach(btn=>btn.onclick=()=>{const rows=$('.recipe-row',$('#recipe'));if(rows.length===1){alert('A recipe needs at least one ingredient.');return}btn.closest('.recipe-row')?.remove()});
    if(!existing){$('#addRecipeIngredient').onclick=()=>{$('#recipeRows').insertAdjacentHTML('beforeend',row());bindRemove()};bindRemove()}
    $('#recipe').onsubmit=async e=>{
      e.preventDefault(); const form=e.currentTarget, fd=new FormData(form), menu=String(fd.get('menu')||''), errorEl=$('#recipeError');
      const entries=$$('.recipe-row',form).map(r=>({inventory_item_id:String($('.recipe-inv',r)?.value||''),quantity:Number($('.recipe-qty',r)?.value||0),recipe_unit:String($('.recipe-unit',r)?.value||'stock').trim()||'stock',stock_units_per_recipe_unit:Number((r.querySelector('.recipe-conversion option:checked')?.textContent.match(/\(([0-9.]+)\)$/)?.[1])||1),conversion_id:String($('.recipe-conversion',r)?.value||'').trim()||null}));
      if(!menu||!entries.length||entries.some(x=>!x.inventory_item_id||!(x.quantity>0)||!(x.stock_units_per_recipe_unit>0))){errorEl.textContent='Enter a valid amount and stock conversion for every ingredient.';errorEl.style.display='block';return}
      const ids=entries.map(x=>x.inventory_item_id); if(new Set(ids).size!==ids.length){errorEl.textContent='The same ingredient was selected more than once. Combine it into one row.';errorEl.style.display='block';return}
      try{
        for(const e of entries){
          const invItem=i.find(q=>q.id===e.inventory_item_id);
          if(invItem && String(e.recipe_unit).toLowerCase()!==String(invItem.unit).toLowerCase() && !e.conversion_id) throw Error('Select the configured serving-unit conversion for '+invItem.name+'.');
        }
        if(existing){
          await api('/rest/v1/menu_item_recipes?id=eq.'+encodeURIComponent(existingId),{method:'PATCH',body:JSON.stringify({menu_item_id:menu,inventory_item_id:entries[0].inventory_item_id,quantity:entries[0].quantity,recipe_unit:entries[0].recipe_unit,stock_units_per_recipe_unit:entries[0].stock_units_per_recipe_unit,conversion_id:entries[0].conversion_id})});
        }else{
          const old=await api('/rest/v1/menu_item_recipes?select=id,inventory_item_id&menu_item_id=eq.'+encodeURIComponent(menu));
          const oldIds=new Set((old||[]).map(x=>x.inventory_item_id)); if(entries.some(x=>oldIds.has(x.inventory_item_id))){errorEl.textContent='One or more ingredients are already mapped to this menu item.';errorEl.style.display='block';return}
          const result=await api('/rest/v1/menu_item_recipes',{method:'POST',body:JSON.stringify(entries.map(x=>({menu_item_id:menu,inventory_item_id:x.inventory_item_id,quantity:x.quantity,recipe_unit:x.recipe_unit,stock_units_per_recipe_unit:x.stock_units_per_recipe_unit,conversion_id:x.conversion_id})))});
          if(!Array.isArray(result)&&!result?.id)throw Error('The recipe was not returned after saving.');
        }
        closeModal(); await loadRecipeMappings();
      }catch(err){errorEl.textContent=humanAdminError(err,'The recipe could not be saved. Please check the entries and try again.');errorEl.style.display='block'}
    };
  }catch(e){msg(e)}
}
async function editRecipe(id){return manageRecipe(id)}
async function loadMenu(){
  const box=$('#menuTable'); if(!box)return;
  box.innerHTML='<div class="state">Loading menu…</div>';
  try{
    let r=[];
    if(profile?.role==='website_manager'){
      const [safe,cats]=await Promise.all([
        api('/rest/v1/rpc/get_public_menu_admin',{method:'POST'}),
        api('/rest/v1/menu_categories?select=id,name,sort_order&active=eq.true&order=sort_order.asc,name.asc')
      ]);
      const catMap=Object.fromEntries((Array.isArray(cats)?cats:[]).map(c=>[c.id,c]));
      r=(Array.isArray(safe)?safe:[]).map(x=>({...x,menu_categories:catMap[x.category_id]||null,service_stations:null}));
    }else{
      // Keep the admin menu loader resilient: fetch base rows and lookup tables separately
      // instead of relying on PostgREST's nested-resource embedding.
      const [items,cats,stations]=await Promise.all([
        api('/rest/v1/menu_items?select=*&order=name.asc'),
        api('/rest/v1/menu_categories?select=id,name,sort_order&active=eq.true&order=sort_order.asc,name.asc'),
        api('/rest/v1/service_stations?select=id,name&active=eq.true&order=sort_order.asc,name.asc')
      ]);
      const catMap=Object.fromEntries((Array.isArray(cats)?cats:[]).map(c=>[c.id,c]));
      const stationMap=Object.fromEntries((Array.isArray(stations)?stations:[]).map(s=>[s.id,s]));
      r=(Array.isArray(items)?items:[]).map(x=>({
        ...x,
        menu_categories:catMap[x.category_id]||null,
        service_stations:stationMap[x.station_id]||null
      }));
    }
    if(['barista'].includes(profile?.role))r=r.filter(x=>x.service_stations?.name==='Barista');
    if(['chef','head_chef'].includes(profile?.role))r=r.filter(x=>x.service_stations?.name==='Kitchen');
    const catSelect=$('#menuCategoryFilter'), search=$('#menuSearch');
    if(catSelect){
      const cats=[...new Map(r.filter(x=>x.menu_categories).map(x=>[x.menu_categories.id,x.menu_categories])).values()]
        .sort((a,b)=>(a.sort_order??999)-(b.sort_order??999)||String(a.name).localeCompare(String(b.name)));
      const current=catSelect.value;
      catSelect.innerHTML='<option value="">All categories</option>'+cats.map(c=>'<option value="'+c.id+'">'+esc(c.name)+'</option>').join('');
      catSelect.value=current;
    }
    const render=()=>{
      const q=String(search?.value||'').trim().toLowerCase(),cat=String(catSelect?.value||'');
      const rows=r.filter(x=>(!cat||x.category_id===cat)&&(!q||[x.name,x.description,x.menu_categories?.name,x.service_stations?.name,x.serving_unit].some(v=>String(v||'').toLowerCase().includes(q))));
      box.innerHTML=rows.length?'<table><thead><tr><th>Name</th><th>Category</th><th>Station</th><th>Serving</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>'+
        rows.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.menu_categories?.name||'')+'</td><td><span class="pill">'+esc(x.service_stations?.name||'Unassigned')+'</span></td><td>'+esc(x.serving_unit||'portion')+'</td><td>'+((x.price_on_request)?'Ask':'UGX '+money(x.price))+'</td><td>'+esc(x.in_stock?'Yes':'No')+'</td><td><button class="btn" data-menu="'+x.id+'">Edit</button> '+((profile?.role==='owner'||hasPermission('content.delete'))?'<button class="btn danger" data-delete-menu="'+x.id+'">Delete</button>':'')+'</td></tr>').join('')+
        '</tbody></table>':'<div class="state">No menu items match your search.</div>';
      $$('[data-menu]').forEach(x=>x.onclick=()=>editMenu(x.dataset.menu));
      $$('[data-delete-menu]').forEach(x=>x.onclick=()=>deleteBusinessRecord('menu_item',x.dataset.deleteMenu,loadMenu));
    };
    if(search)search.oninput=render;
    if(catSelect)catSelect.onchange=render;
    render();
  }catch(e){
    console.error('Kiteezi menu load failed:',e);
    box.innerHTML='<div class="state">Menu could not be loaded. Please refresh and try again.</div>';
  }
}
async function editMenu(id=null){
  const isWebsite=profile?.role==='website_manager';
  const cats=await api('/rest/v1/menu_categories?select=id,name&active=eq.true&order=sort_order.asc,name.asc');
  let x;
  if(id){
    if(isWebsite)x=(await api('/rest/v1/rpc/get_public_menu_admin_item',{method:'POST',body:JSON.stringify({p_id:id})}))?.[0];
    else x=(await api('/rest/v1/menu_items?id=eq.'+id))[0];
  }else{
    if(isWebsite){alert('Website managers can edit existing public menu content. New menu items are created by menu operations staff.');return;}
    x={name:'',description:'',price:0,img_url:'',price_on_request:false,in_stock:true,category_id:null,station_id:null,serving_unit:'portion'};
  }
  if(!x)throw Error('Menu item could not be loaded.');
  if(profile?.role==='barista')cats.splice(0,cats.length,...cats.filter(q=>/drink|beverage/i.test(q.name)));
  if(['chef','head_chef'].includes(profile?.role))cats.splice(0,cats.length,...cats.filter(q=>!/drink|beverage/i.test(q.name)));
  if(isWebsite){
    modal('Edit public menu content','<form id="mi" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Public menu name" required><select name="category"><option value="">No category</option>'+cats.map(q=>'<option value="'+q.id+'" '+(x.category_id===q.id?'selected':'')+'>'+esc(q.name)+'</option>').join('')+'</select><textarea name="description" placeholder="Public description">'+esc(x.description||'')+'</textarea><label>Image<input id="menuImageFile" name="imageFile" type="file" accept="image/*"></label><input name="img" value="'+esc(x.img_url||'')+'" placeholder="Image URL"><input name="alt" value="'+esc(x.alt_text||'')+'" placeholder="Image alt text"><button class="btn btn-dark">Save public content</button></form>');
    $('#mi').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);let imageUrl=String(f.get('img')||'').trim();const file=f.get('imageFile');if(file instanceof File&&file.size)imageUrl=await uploadAdminImage(file,'menu');try{await api('/rest/v1/menu_items?id=eq.'+id,{method:'PATCH',body:JSON.stringify({name:f.get('name'),category_id:f.get('category')||null,description:f.get('description')||null,img_url:imageUrl||null,alt_text:f.get('alt')||null})});closeModal();loadMenu()}catch(err){msg(err)}};
    return;
  }
  const [allStations]=await Promise.all([api('/rest/v1/service_stations?select=id,name&active=eq.true&order=sort_order.asc'),loadUnitOptions()]);
  const allowedStationName=profile?.role==='barista'?'Barista':(['chef','head_chef'].includes(profile?.role)?'Kitchen':null);
  const stations=allowedStationName?allStations.filter(q=>q.name===allowedStationName):allStations;
  modal(id?'Menu item':'Add menu item','<form id="mi" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Name" required><select name="category"><option value="">No category</option>'+cats.map(q=>'<option value="'+q.id+'" '+(x.category_id===q.id?'selected':'')+'>'+esc(q.name)+'</option>').join('')+'</select><select name="station" required><option value="">Choose preparation station</option>'+stations.map(q=>'<option value="'+q.id+'" '+(x.station_id===q.id?'selected':'')+'>'+esc(q.name)+'</option>').join('')+'</select><select name="serving" required>'+unitOptionsHtml(x.serving_unit||'portion')+'</select><textarea name="description" placeholder="Description">'+esc(x.description||'')+'</textarea><input name="price" type="number" step="0.01" value="'+(x.price||0)+'" placeholder="Price"><label>Image<input id="menuImageFile" name="imageFile" type="file" accept="image/*"><small class="muted">Choose an image from your phone or computer, or paste an image URL below.</small></label><input name="img" value="'+esc(x.img_url||'')+'" placeholder="Image URL"><label>Price on request <input name="por" type="checkbox" '+(x.price_on_request?'checked':'')+'></label><label>In stock <input name="stock" type="checkbox" '+(x.in_stock?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#mi').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);let imageUrl=String(f.get('img')||'').trim();const file=f.get('imageFile');if(file instanceof File&&file.size)imageUrl=await uploadAdminImage(file,'menu');const body={name:f.get('name'),category_id:f.get('category')||null,station_id:f.get('station')||null,serving_unit:String(f.get('serving')||'portion').trim()||'portion',description:f.get('description')||null,price:Number(f.get('price')||0),img_url:imageUrl||null,price_on_request:f.get('por')==='on',in_stock:f.get('stock')==='on'};await api(id?'/rest/v1/menu_items?id=eq.'+id:'/rest/v1/menu_items',{method:id?'PATCH':'POST',body:JSON.stringify(body)});closeModal();loadMenu()}
}
async function loadServices(){
  const gmReadOnly=profile?.role==='general_manager';
  let [s,sp]=await Promise.all([api('/rest/v1/services?select=*&order=name.asc'),api('/rest/v1/sports?select=*&order=name.asc')]);
  if(['head_swimming_coach','swimming_coach'].includes(profile?.role))s=s.filter(x=>/swim/i.test(x.name+' '+(x.description||'')));
  $('#servicesTable').innerHTML='<table><tr><th>Name</th><th>Price</th><th>Pricing</th><th>Active</th><th></th></tr>'+s.map(x=>'<tr><td>'+esc(x.name)+'</td><td>UGX '+money(x.price)+'</td><td>'+esc(x.pricing_mode||'fixed')+'</td><td>'+x.active+'</td><td>'+(gmReadOnly?'View only':'<button class="btn" data-svc="'+x.id+'">Edit</button> '+((profile?.role==='owner'||hasPermission('content.delete'))?'<button class="btn danger" data-delete-svc="'+x.id+'">Delete</button>':''))+'</td></tr>').join('')+'</table>';
  $('#sportsTable').innerHTML='<table><tr><th>Sport</th><th>Description</th><th>Active</th><th></th></tr>'+sp.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.description||'')+'</td><td>'+x.active+'</td><td>'+(gmReadOnly?'View only':'<button class="btn" data-sport="'+x.id+'">Edit</button> '+((profile?.role==='owner'||hasPermission('content.delete'))?'<button class="btn danger" data-delete-sport="'+x.id+'">Delete</button>':''))+'</td></tr>').join('')+'</table>';
  document.querySelectorAll('[data-svc]').forEach(x=>x.onclick=()=>editService(x.dataset.svc));
  document.querySelectorAll('[data-sport]').forEach(x=>x.onclick=()=>editSport(x.dataset.sport));
  document.querySelectorAll('[data-delete-svc]').forEach(x=>x.onclick=()=>deleteBusinessRecord('service',x.dataset.deleteSvc,loadServices));
  document.querySelectorAll('[data-delete-sport]').forEach(x=>x.onclick=()=>deleteBusinessRecord('sport',x.dataset.deleteSport,loadServices));
}
async function editService(id=null){const x=id?(await api('/rest/v1/services?id=eq.'+id))[0]:{name:'',description:'',price:0,team_threshold:null,small_group_price:null,full_team_price:null,active:true,pricing_mode:'fixed'};modal(id?'Service':'Add service','<form id="svc" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Service name" required><textarea name="description" placeholder="Description">'+esc(x.description||'')+'</textarea><input name="price" type="number" value="'+(x.price||0)+'" placeholder="Base price"><input name="duration" type="number" value="'+(x.duration_minutes||'')+'" placeholder="Duration minutes"><select name="pricing"><option value="fixed" '+(x.pricing_mode==='fixed'?'selected':'')+'>Fixed</option><option value="per_person" '+(x.pricing_mode==='per_person'?'selected':'')+'>Per person</option><option value="team" '+(x.pricing_mode==='team'?'selected':'')+'>Team</option></select><input name="threshold" type="number" value="'+(x.team_threshold||'')+'" placeholder="Team threshold"><input name="small" type="number" value="'+(x.small_group_price||'')+'" placeholder="Small group price"><input name="full" type="number" value="'+(x.full_team_price||'')+'" placeholder="Full team price"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#svc').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={name:f.get('name'),description:f.get('description')||null,price:Number(f.get('price')||0),duration_minutes:Number(f.get('duration')||0)||null,pricing_mode:f.get('pricing'),team_threshold:Number(f.get('threshold')||0)||null,small_group_price:Number(f.get('small')||0)||null,full_team_price:Number(f.get('full')||0)||null,active:f.get('active')==='on'};await api(id?'/rest/v1/services?id=eq.'+id:'/rest/v1/services',{method:id?'PATCH':'POST',body:JSON.stringify(body)});closeModal();loadServices()}}
async function editSport(id=null){const x=id?(await api('/rest/v1/sports?id=eq.'+id))[0]:{name:'',description:'',active:true};modal(id?'Sport':'Add sport','<form id="sport" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Sport name" required><textarea name="description" placeholder="Description">'+esc(x.description||'')+'</textarea><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#sport').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={name:f.get('name'),description:f.get('description')||null,active:f.get('active')==='on'};await api(id?'/rest/v1/sports?id=eq.'+id:'/rest/v1/sports',{method:id?'PATCH':'POST',body:JSON.stringify(body)});closeModal();loadServices()}}
async function storageUpload(bucket,path,file){const r=await fetch(URL+'/storage/v1/object/'+encodeURIComponent(bucket)+'/'+path,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':file.type,'x-upsert':'false'},body:file});if(!r.ok)throw Error(await r.text()||'Storage upload failed.');}
async function loadGallery(){const rows=await api('/rest/v1/gallery_items?select=*&order=status.asc,created_at.desc');const canModerate=hasPermission('gallery.moderate')||hasPermission('gallery.manage');const canUpload=hasPermission('gallery.upload')||hasPermission('gallery.manage');$('#galleryTable').innerHTML=rows.length?'<table><tr><th>Submitted</th><th>Source</th><th>Type</th><th>Category</th><th>Submitter</th><th>Status</th><th>Actions</th></tr>'+rows.map(x=>{const actions=[];if(canModerate&&x.status==='pending')actions.push('<button class="btn" data-ga="approve" data-id="'+x.id+'">Approve</button>','<button class="btn danger" data-ga="reject" data-id="'+x.id+'">Reject</button>');if(canModerate)actions.push('<button class="btn" data-ga="preview" data-id="'+x.id+'">Preview</button>');if(hasPermission('gallery.manage'))actions.push('<button class="btn danger" data-ga="delete" data-id="'+x.id+'">Delete</button>');return '<tr data-gallery-row="'+x.id+'"><td>'+esc(new Date(x.created_at).toLocaleString())+'</td><td>'+esc(x.source)+'</td><td>'+esc(x.media_type)+'</td><td>'+esc(x.category)+'</td><td>'+esc(x.submitter_name||'Staff')+'</td><td>'+esc(x.status)+'</td><td>'+actions.join(' ')+'</td></tr>'}).join('')+'</table>':'<div class="state">No gallery submissions.</div>';$$('[data-ga]').forEach(b=>b.onclick=()=>galleryAction(b.dataset.ga,b.dataset.id));const add=$('#newGalleryMedia');if(add)add.hidden=!canUpload;}
async function galleryAction(action,id){const x=(await api('/rest/v1/gallery_items?id=eq.'+encodeURIComponent(id)))[0];if(!x)return;if(action==='preview'){const path=x.storage_path.split('/').map(encodeURIComponent).join('/');const objectUrl=x.storage_bucket==='gallery-public'?URL+'/storage/v1/object/public/'+encodeURIComponent(x.storage_bucket)+'/'+path:URL+'/storage/v1/object/authenticated/'+encodeURIComponent(x.storage_bucket)+'/'+path;const r=await fetch(objectUrl,x.storage_bucket==='gallery-public'?{}:{headers:{apikey:KEY,Authorization:'Bearer '+session.access_token}});if(!r.ok)return msg(Error('Preview could not be loaded.'));const blob=await r.blob(),u=URL.createObjectURL(blob);modal('Gallery preview',x.media_type==='video'?'<video controls autoplay playsinline style="max-width:100%;max-height:70vh" src="'+u+'"></video>':'<img style="max-width:100%;max-height:70vh;object-fit:contain" src="'+u+'" alt="">');return}if(action==='delete'){if(!confirm('Delete this gallery item?'))return;await api('/rest/v1/gallery_items?id=eq.'+id,{method:'DELETE'});await fetch(URL+'/storage/v1/object/'+encodeURIComponent(x.storage_bucket)+'/'+x.storage_path,{method:'DELETE',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token}}).catch(()=>{});return loadGallery()}if(action==='reject'){const reason=prompt('Reason for rejection (optional):')||null;await api('/rest/v1/gallery_items?id=eq.'+id,{method:'PATCH',body:JSON.stringify({status:'rejected',rejection_reason:reason,updated_at:new Date().toISOString()})});return loadGallery()}if(action==='approve'){const orgPath='gallery/'+id+'/'+x.storage_path.split('/').pop();const privatePath=x.storage_path.split('/').map(encodeURIComponent).join('/');const rr=await fetch(URL+'/storage/v1/object/authenticated/'+encodeURIComponent(x.storage_bucket)+'/'+privatePath,{headers:{apikey:KEY,Authorization:'Bearer '+session.access_token}});if(!rr.ok)throw Error('Private media could not be read.');const blob=await rr.blob();const put=await fetch(URL+'/storage/v1/object/gallery-public/'+orgPath,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':blob.type,'x-upsert':'false'},body:blob});if(!put.ok)throw Error(await put.text()||'Could not publish media.');await api('/rest/v1/gallery_items?id=eq.'+id,{method:'PATCH',body:JSON.stringify({storage_bucket:'gallery-public',storage_path:orgPath,status:'approved',approved_by:session.user.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()})});await fetch(URL+'/storage/v1/object/gallery-private/'+x.storage_path,{method:'DELETE',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token}}).catch(()=>{});return loadGallery()}}
async function addGalleryMedia(){const orgRows=await api('/rest/v1/organizations?select=id&status=eq.active&order=created_at.asc&limit=1');const org=orgRows?.[0]?.id;if(!org)return msg(Error('Organization configuration is missing.'));modal('Upload gallery media','<form id="galleryAdminForm" class="form"><label>Title<input name="title" maxlength="160"></label><label>Caption<textarea name="caption" maxlength="500"></textarea></label><label>Category<select name="category"><option>General</option><option>Events</option><option>Food & Drinks</option><option>Sports</option><option>Swimming</option><option>Recreation</option><option>Facility</option></select></label><label>Image or video<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime" required><small class="muted">Maximum 50 MB.</small></label><button class="btn btn-dark">Upload</button></form>');$('#galleryAdminForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),file=f.get('file');if(!file||file.size>52428800)return alert('Choose a file no larger than 50 MB.');const imageTypes=['image/jpeg','image/png','image/webp','image/gif','image/avif'],videoTypes=['video/mp4','video/webm','video/quicktime'];if(![...imageTypes,...videoTypes].includes(file.type))return alert('Unsupported media type.');const type=imageTypes.includes(file.type)?'image':'video',ext=(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'');const button=e.currentTarget.querySelector('button[type="submit"]')||e.currentTarget.querySelector('button');try{if(button){button.disabled=true;button.textContent='Uploading…'}const publicPath='staff/'+crypto.randomUUID()+'.'+ext;await storageUpload('gallery-public',publicPath,file);await api('/rest/v1/gallery_items',{method:'POST',body:JSON.stringify({organization_id:org,title:f.get('title')||null,caption:f.get('caption')||null,category:f.get('category')||'General',media_type:type,storage_bucket:'gallery-public',storage_path:publicPath,source:'staff',consent_given:true,status:'approved',approved_by:session.user.id,approved_at:new Date().toISOString()})});closeModal();await loadGallery();alert('Gallery media uploaded.')}catch(err){msg(err)}finally{if(button){button.disabled=false;button.textContent='Upload'}}}}
async function loadContent(){
  const gmReadOnly=profile?.role==='general_manager';
  const [p,m,a]=await Promise.all([api('/rest/v1/cms_pages?select=*&order=slug.asc'),api('/rest/v1/media?select=*&order=page_slug.asc,sort_order.asc'),api('/rest/v1/announcements?select=*&order=starts_at.desc')]);
  $('#pagesTable').innerHTML='<table><tr><th>Slug</th><th>Title</th><th>Published</th><th></th></tr>'+p.map(x=>'<tr><td>'+esc(x.slug)+'</td><td>'+esc(x.title||'')+'</td><td>'+x.published+'</td><td>'+(gmReadOnly?'View only':'<button class="btn" data-page="'+x.id+'">Edit</button>')+'</td></tr>').join('')+'</table>';
  $('#mediaTable').innerHTML='<table><tr><th>Page</th><th>Title</th><th>URL</th><th>Active</th><th></th></tr>'+m.map(x=>'<tr><td>'+esc(x.page_slug||'')+'</td><td>'+esc(x.title||'')+'</td><td>'+esc(x.url)+'</td><td>'+x.active+'</td><td>'+(gmReadOnly?'View only':'<button class="btn" data-media="'+x.id+'">Edit</button> '+((profile?.role==='owner'||hasPermission('content.delete'))?'<button class="btn danger" data-delete-media="'+x.id+'">Delete</button>':''))+'</td></tr>').join('')+'</table>';
  $('#announcementsTable').innerHTML='<table><tr><th>Title</th><th>Published</th><th>Body</th><th></th></tr>'+a.map(x=>'<tr><td>'+esc(x.title)+'</td><td>'+x.published+'</td><td>'+esc(x.body||'')+'</td><td>'+(gmReadOnly?'View only':'<button class="btn" data-ann="'+x.id+'">Edit</button> '+((profile?.role==='owner'||hasPermission('content.delete'))?'<button class="btn danger" data-delete-ann="'+x.id+'">Delete</button>':''))+'</td></tr>').join('')+'</table>';
  document.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>editPage(x.dataset.page));
  document.querySelectorAll('[data-media]').forEach(x=>x.onclick=()=>editMedia(x.dataset.media));
  document.querySelectorAll('[data-ann]').forEach(x=>x.onclick=()=>editAnnouncement(x.dataset.ann));
  $$('[data-delete-media]').forEach(x=>x.onclick=()=>deleteBusinessRecord('media',x.dataset.deleteMedia,loadContent));
  $$('[data-delete-ann]').forEach(x=>x.onclick=()=>deleteBusinessRecord('announcement',x.dataset.deleteAnn,loadContent));
}
async function loadCustomers(){const rows=await api('/rest/v1/customers?select=id,name,phone,email,notes,created_at&order=created_at.desc');const box=$('#customersTable');if(!box)return;box.innerHTML=rows.length?'<table><tr><th>Customer</th><th>Phone</th><th>Email</th><th>Added</th><th></th></tr>'+rows.map(x=>'<tr><td>'+esc(x.name||'')+'</td><td>'+esc(x.phone||'')+'</td><td>'+esc(x.email||'')+'</td><td>'+esc(new Date(x.created_at).toLocaleDateString())+'</td><td>'+(profile?.role==='owner'?'<button class="btn danger" data-delete-customer="'+x.id+'">Delete</button>':'')+'</td></tr>').join('')+'</table>':'<div class="state">No customer profiles found.</div>';$$('[data-delete-customer]').forEach(b=>b.onclick=()=>deleteBusinessRecord('customer',b.dataset.deleteCustomer,loadCustomers))}
function table(h,rows,fn){return '<table><tr>'+h.map(x=>'<th>'+x+'</th>').join('')+'</tr>'+rows.map(x=>'<tr>'+fn(x).map(v=>'<td>'+((typeof v==='string'&&v.trim().startsWith('<button'))?v:esc(v))+'</td>').join('')+'</tr>').join('')+'</table>'}
async function editPage(id){const x=(await api('/rest/v1/cms_pages?id=eq.'+id))[0];modal('CMS page','<form id="ed" class="form"><input name="title" value="'+esc(x.title||'')+'"><textarea name="content">'+esc(JSON.stringify(x.content||{},null,2))+'</textarea><label>Published <input name="published" type="checkbox" '+(x.published?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#ed').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);let content={};try{content=JSON.parse(f.get('content')||'{}')}catch{alert('Content must be valid JSON');return}await api('/rest/v1/cms_pages?id=eq.'+id,{method:'PATCH',body:JSON.stringify({title:f.get('title'),content,published:f.get('published')==='on',updated_at:new Date().toISOString()})});closeModal();loadContent()}}
async function editMedia(id){const x=(await api('/rest/v1/media?id=eq.'+id))[0];modal('Media','<form id="ed" class="form"><input name="title" value="'+esc(x.title||'')+'"><label>Upload replacement from device<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime"><small class="muted">Optional. Maximum 50 MB. If selected, it replaces the current media.</small></label><input name="url" value="'+esc(x.url||'')+'" placeholder="Existing or external public URL"><input name="alt" value="'+esc(x.alt_text||'')+'" placeholder="Alt text"><input name="page" value="'+esc(x.page_slug||'')+'" placeholder="Page slug"><input name="sort" type="number" value="'+x.sort_order+'"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#ed').onsubmit=async e=>{e.preventDefault();const form=new FormData(e.currentTarget),file=form.get('file');let url=String(form.get('url')||'').trim();try{if(file instanceof File&&file.size){if(file.size>52428800)throw Error('File exceeds the 50 MB limit.');const path='site/'+crypto.randomUUID()+'.'+(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'');await storageUpload('site-media',path,file);url=URL+'/storage/v1/object/public/site-media/'+path.split('/').map(encodeURIComponent).join('/')}if(!url)throw Error('Choose a local file or provide a public URL.');await api('/rest/v1/media?id=eq.'+id,{method:'PATCH',body:JSON.stringify({title:form.get('title'),url,alt_text:form.get('alt'),page_slug:form.get('page'),sort_order:Number(form.get('sort')||0),active:form.get('active')==='on'})});closeModal();loadContent()}catch(err){msg(err)}}}
async function editAnnouncement(id){const x=(await api('/rest/v1/announcements?id=eq.'+id))[0];modal('Announcement','<form id="ed" class="form"><input name="title" value="'+esc(x.title)+'" required><textarea name="body">'+esc(x.body||'')+'</textarea><label>Published <input name="published" type="checkbox" '+(x.published?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#ed').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/rest/v1/announcements?id=eq.'+id,{method:'PATCH',body:JSON.stringify({title:f.get('title'),body:f.get('body'),published:f.get('published')==='on'})});closeModal();loadContent()}}
async function addMedia(){modal('Add media','<form id="mediaForm" class="form"><input name="title" placeholder="Title"><label>Upload from device<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime"><small class="muted">Maximum 50 MB.</small></label><input name="url" placeholder="Or paste an existing public URL"><input name="alt" placeholder="Alt text"><input name="page" placeholder="Page slug"><input name="area" placeholder="Website area (e.g. home, menu, about)" value="website" required><select name="type"><option value="image">Image</option><option value="video">Video</option></select><input name="sort" type="number" value="0"><small class="muted">Website Media is separate from the public Gallery. Customer Gallery submissions are managed in the Gallery section.</small><label>Active <input name="active" type="checkbox" checked></label><button class="btn btn-dark">Save</button></form>');$('#mediaForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),file=f.get('file');let url=String(f.get('url')||'').trim();try{if(file&&file.size){if(file.size>52428800)throw Error('File exceeds the 50 MB limit.');const path='site/'+crypto.randomUUID()+'.'+(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'');await storageUpload('site-media',path,file);url=URL+'/storage/v1/object/public/site-media/'+path.split('/').map(encodeURIComponent).join('/')}if(!url)throw Error('Choose a local file or provide a public URL.');await api('/rest/v1/media',{method:'POST',body:JSON.stringify({title:f.get('title')||null,url,alt_text:f.get('alt')||null,page_slug:f.get('page')||null,area:f.get('area'),type:f.get('type')||null,sort_order:Number(f.get('sort')||0),is_gallery:false,active:f.get('active')==='on'})});closeModal();loadContent()}catch(err){msg(err)}}}
async function addAnnouncement(){modal('Add announcement','<form id="annForm" class="form"><input name="title" placeholder="Title" required><textarea name="body" placeholder="Message"></textarea><input name="starts" type="datetime-local"><input name="ends" type="datetime-local"><label>Published <input name="published" type="checkbox"></label><button class="btn btn-dark">Save</button></form>');$('#annForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/rest/v1/announcements',{method:'POST',body:JSON.stringify({title:f.get('title'),body:f.get('body')||null,starts_at:f.get('starts')?new Date(f.get('starts')).toISOString():null,ends_at:f.get('ends')?new Date(f.get('ends')).toISOString():null,published:f.get('published')==='on'})});closeModal();loadContent()}}
async function loadReviews(){const gmReadOnly=profile?.role==='general_manager';const r=await api('/rest/v1/reviews?select=*&order=created_at.desc');$('#reviewsTable').innerHTML=table(['Name','Rating','Message','Status',''],r,x=>[x.customer_name,x.rating,x.message,x.approved?'Approved':'Pending',(gmReadOnly?'View only':(hasPermission('reviews.moderate')?'<button class="btn" data-review-approve="'+x.id+'">'+(x.approved?'Keep approved':'Approve')+'</button> <button class="btn danger" data-review-reject="'+x.id+'">Reject</button> ':''))+(profile?.role==='owner'?'<button class="btn danger" data-rm="'+x.id+'">Delete</button>':'')]);document.querySelectorAll('[data-review-approve]').forEach(b=>b.onclick=async()=>{try{await api('/rest/v1/reviews?id=eq.'+encodeURIComponent(b.dataset.reviewApprove),{method:'PATCH',body:JSON.stringify({approved:true})});await loadReviews()}catch(e){msg(e)}});document.querySelectorAll('[data-review-reject]').forEach(b=>b.onclick=async()=>{try{await api('/rest/v1/reviews?id=eq.'+encodeURIComponent(b.dataset.reviewReject),{method:'PATCH',body:JSON.stringify({approved:false})});await loadReviews()}catch(e){msg(e)}});document.querySelectorAll('[data-rm]').forEach(x=>x.onclick=()=>deleteTestRecord('review',x.dataset.rm))}
async function loadSocial(){const gmReadOnly=profile?.role==='general_manager';const r=await api('/rest/v1/social_links?select=*&order=sort_order.asc');$('#socialTable').innerHTML=table(['Platform','Label','URL','Active',''],r,x=>[x.platform,x.label,x.url,x.active,gmReadOnly?'View only':'<button class="btn" data-sl="'+x.id+'">Edit</button> '+((profile?.role==='owner'||hasPermission('content.delete'))?'<button class="btn danger" data-delete-social="'+x.id+'">Delete</button>':'')]);document.querySelectorAll('[data-sl]').forEach(x=>x.onclick=()=>editSocial(x.dataset.sl));document.querySelectorAll('[data-delete-social]').forEach(x=>x.onclick=()=>deleteBusinessRecord('social_link',x.dataset.deleteSocial,loadSocial))}
async function editSocial(id){const x=id?(await api('/rest/v1/social_links?id=eq.'+id))[0]:{platform:'',label:'',url:'',sort_order:0,active:true};if(id&&!x)throw Error('The social link could not be found.');modal('Social link','<form id="sl" class="form"><input name="platform" value="'+esc(x.platform)+'" placeholder="Platform" required><input name="label" value="'+esc(x.label)+'" placeholder="Label"><input name="url" type="url" value="'+esc(x.url)+'" placeholder="https://..." required><input name="sort" type="number" value="'+Number(x.sort_order||0)+'"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><div id="slStatus" class="notice" hidden></div><button id="slSave" class="btn btn-dark" type="submit">Save</button></form>');$('#sl').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),button=$('#slSave'),status=$('#slStatus');const body={platform:String(f.get('platform')||'').trim(),label:String(f.get('label')||'').trim(),url:String(f.get('url')||'').trim(),sort_order:Number(f.get('sort')||0),active:f.get('active')==='on'};if(!body.platform||!body.url){if(status){status.hidden=false;status.textContent='Platform and URL are required.';status.className='notice danger'}return}if(button){button.disabled=true;button.textContent='Saving…'}if(status){status.hidden=true}try{await api(id?'/rest/v1/social_links?id=eq.'+encodeURIComponent(id):'/rest/v1/social_links',{method:id?'PATCH':'POST',body:JSON.stringify(body)});await loadSocial();closeModal();showAdminToast('Saved','Social link saved successfully.')}catch(err){console.error('Social link save failed:',err);if(status){status.hidden=false;status.textContent=humanAdminError(err,'The social link could not be saved. Please try again.');status.className='notice danger'}if(button){button.disabled=false;button.textContent='Save'}}}}
async function loadRolesAndPermissions(){
  const [roles,perms]=await Promise.all([
    api('/rest/v1/roles?select=id,name,description&order=name.asc'),
    api('/rest/v1/permissions?select=id,code,description&order=code.asc')
  ]);
  const rp=await api('/rest/v1/role_permissions?select=role_id,permission_id');
  const byRole={}; (rp||[]).forEach(x=>(byRole[x.role_id]??=[]).push(x.permission_id));
  const canManage=hasPermission('staff.manage')||hasPermission('roles.manage');
  const roleRows=(roles||[]).map(r=>'<tr><td><strong>'+esc(r.name)+'</strong></td><td>'+esc(r.description||'')+'</td><td><span class="pill">'+((byRole[r.id]||[]).length)+' permissions</span></td><td>'+(canManage?'<button class="btn" data-role-edit="'+r.id+'">Edit permissions</button> ':'')+(profile?.role==='owner'?'<button class="btn danger" data-delete-role="'+r.id+'">Delete</button>':'')+'</td></tr>').join('');
  const box=$('#rolesTable'); if(box) box.innerHTML=roleRows?'<div class="table-scroll"><table><thead><tr><th>Role</th><th>Description</th><th>Access</th><th></th></tr></thead><tbody>'+roleRows+'</tbody></table></div>':'<div class="state">No roles found.</div>';
  const edit=async id=>{
    const role=(roles||[]).find(x=>x.id===id); if(!role)return;
    const selected=new Set(byRole[id]||[]);
    modal('Role permissions — '+role.name,'<form id="rolePermForm" class="form"><p class="muted">Existing permissions are preserved. Changes affect access only; they do not delete operational data.</p><div class="permission-list">'+(perms||[]).map(p=>'<label><input type="checkbox" value="'+p.id+'" '+(selected.has(p.id)?'checked':'')+'>'+esc(p.code)+(p.description?' — '+esc(p.description):'')+'</label>').join('')+'</div><button class="btn btn-dark">Save permissions</button></form>');
    $('#rolePermForm').onsubmit=async e=>{e.preventDefault();const ids=[...e.currentTarget.querySelectorAll('input:checked')].map(x=>x.value);try{
      const current=await api('/rest/v1/role_permissions?select=permission_id&role_id=eq.'+encodeURIComponent(id));
      for(const x of current||[]) if(!ids.includes(String(x.permission_id))) await api('/rest/v1/role_permissions?role_id=eq.'+encodeURIComponent(id)+'&permission_id=eq.'+encodeURIComponent(x.permission_id),{method:'DELETE'});
      const existing=new Set((current||[]).map(x=>String(x.permission_id)));
      const add=ids.filter(x=>!existing.has(String(x))).map(permission_id=>({role_id:id,permission_id}));
      if(add.length) await api('/rest/v1/role_permissions',{method:'POST',body:JSON.stringify(add)});
      closeModal(); await loadRolesAndPermissions(); await loadPermissions(); applyRoleNavigation();
    }catch(err){msg(err)}
    };
  };
  $$('[data-role-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.roleEdit));$$('[data-delete-role]').forEach(b=>b.onclick=()=>deleteBusinessRecord('role',b.dataset.deleteRole,loadRolesAndPermissions));
}
async function loadTeamPositions(){const rows=await api('/rest/v1/team_positions?select=id,department,position,person_name,sort_order,active&order=sort_order.asc');$('#teamPositionsTable').innerHTML='<table><tr><th>Department</th><th>Position</th><th>Person</th><th>Active</th><th></th></tr>'+rows.map(x=>'<tr><td>'+esc(x.department)+'</td><td>'+esc(x.position)+'</td><td>'+esc(x.person_name||'')+'</td><td>'+x.active+'</td><td><button class="btn" data-team-edit="'+x.id+'">Edit</button> '+(profile?.role==='owner'?'<button class="btn danger" data-team-delete="'+x.id+'">Delete</button>':'')+'</td></tr>').join('')+'</table>';document.querySelectorAll('[data-team-edit]').forEach(x=>x.onclick=()=>editTeamPosition(x.dataset.teamEdit));document.querySelectorAll('[data-team-delete]').forEach(x=>x.onclick=()=>deleteBusinessRecord('team_position',x.dataset.teamDelete,loadTeamPositions))}

function editTeamPosition(id){const load=id?api('/rest/v1/team_positions?id=eq.'+id):Promise.resolve([{department:'',position:'',person_name:'',sort_order:100,active:true}]);load.then(rows=>{const x=rows[0];modal(id?'Edit position':'Add position','<form id="teamPositionForm" class="form"><input name="department" required placeholder="Department" value="'+esc(x.department||'')+'"><input name="position" required placeholder="Position" value="'+esc(x.position||'')+'"><input name="person_name" placeholder="Person’s name" value="'+esc(x.person_name||'')+'"><input name="sort_order" type="number" value="'+Number(x.sort_order||100)+'"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark" type="submit">Save</button></form>');$('#teamPositionForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const body={department:String(f.get('department')||'').trim(),position:String(f.get('position')||'').trim(),person_name:String(f.get('person_name')||'').trim(),sort_order:Number(f.get('sort_order')||100),active:f.get('active')==='on',updated_at:new Date().toISOString()};await api(id?'/rest/v1/team_positions?id=eq.'+id:'/rest/v1/team_positions',{method:id?'PATCH':'POST',body:JSON.stringify(body)});await loadTeamPositions();window.dispatchEvent(new CustomEvent('team-positions-updated'));closeModal()}})}
async function deleteTeamPosition(id){if(!confirm('Remove this public position?'))return;await api('/rest/v1/team_positions?id=eq.'+id,{method:'DELETE'});loadTeamPositions()}
async function loadStaffPositions(){const rows=await api('/rest/v1/team_positions?select=id,department,position,person_name,active&active=eq.true&order=department.asc,sort_order.asc,position.asc');return Array.isArray(rows)?rows:[]}
function staffPositionOptions(rows,selected=''){return '<option value="">No position assigned</option>'+rows.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===selected?'selected':'')+'>'+esc(p.position)+(p.department?' — '+esc(p.department):'')+(p.person_name?' ('+esc(p.person_name)+')':'')+'</option>').join('')}
let staffPositionEventBound=false;
function bindStaffPositionRefresh(){
  if(staffPositionEventBound)return;
  staffPositionEventBound=true;
  window.addEventListener('team-positions-updated',async()=>{
    const latest=await loadStaffPositions();
    ['#newStaffPosition','#staffPosition'].forEach(sel=>{
      const el=$(sel);
      if(el){
        const current=el.value;
        el.innerHTML=staffPositionOptions(latest,current);
      }
    });
  });
}

async function addStaff(){bindStaffPositionRefresh();
  const [roles,positions,supervisors]=await Promise.all([
    api('/rest/v1/roles?select=id,name&order=name.asc'),
    loadStaffPositions(),
    api('/rest/v1/profiles?select=id,full_name,role&active=eq.true&order=full_name.asc')
  ]);
  const options=roles.map(r=>'<option value="'+esc(r.name)+'">'+esc(r.name)+'</option>').join('');
  const supervisorOptions='<option value="">No direct supervisor</option>'+supervisors.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.full_name)+' — '+esc(s.role)+'</option>').join('');
  modal('Add staff / owner','<form id="newStaffForm" class="form"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email address" required><input name="password" type="password" minlength="8" placeholder="Password (8+ characters)" required><input name="phone" placeholder="Phone"><label>Login / Access Role<select name="role" required><option value="">Choose access role</option>'+options+'</select></label><label>Public Website Role / Position<select name="position_id" id="newStaffPosition">'+staffPositionOptions(positions)+'</select></label><label>Employment type<select name="employment_type"><option value="">Not set</option><option value="salary">Salary</option><option value="wage">Wage / day worker</option><option value="contract">Contract</option><option value="casual">Casual</option></select></label><label>Pay frequency<select name="pay_frequency"><option value="">Not set</option><option value="monthly">Monthly</option><option value="daily">Daily</option><option value="hourly">Hourly</option><option value="per_shift">Per shift</option></select></label><label>Reports to<select name="supervisor_profile_id">'+supervisorOptions+'</select></label><label>Profile image from device<input name="avatar_file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif"><small class="muted">Choose from your device, or use the URL below.</small></label><input name="avatar_url" type="url" placeholder="Or paste profile image URL (optional)"><textarea name="background_info" placeholder="Background information about the person"></textarea><p class="muted">Access Role controls permissions. Employment type/pay frequency control payroll classification. Reports to records the direct operational supervisor.</p><button class="btn btn-dark">Create account</button></form>');
  $('#newStaffForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const body={name:String(f.get('name')||'').trim(),email:String(f.get('email')||'').trim(),password:String(f.get('password')||''),phone:String(f.get('phone')||'').trim(),role:String(f.get('role')||'').trim(),position_id:String(f.get('position_id')||'').trim()||null,employment_type:String(f.get('employment_type')||'').trim()||null,pay_frequency:String(f.get('pay_frequency')||'').trim()||null,supervisor_profile_id:String(f.get('supervisor_profile_id')||'').trim()||null,avatar_url:String(f.get('avatar_url')||'').trim(),background_info:String(f.get('background_info')||'').trim()};try{const avatarFile=f.get('avatar_file');if(avatarFile instanceof File&&avatarFile.size){if(avatarFile.size>52428800)throw Error('Profile image exceeds the 50 MB limit.');body.avatar_url=await uploadAdminImage(avatarFile,'staff')}await api('/functions/v1/create-staff',{method:'POST',body:JSON.stringify(body)});alert('Account created.');closeModal();loadStaff()}catch(err){alert(humanAdminError(err,'Could not create the staff account. Please check the details and try again.'))}}}
let showInactiveStaff=false;
async function loadStaff(){
  const activeFilter=showInactiveStaff?'':'&active=eq.true';
  const [r,roles]=await Promise.all([
    api('/rest/v1/profiles?select=id,full_name,phone,role,position_id,active,employment_type,pay_frequency,supervisor_profile_id,created_at,avatar_url,background_info,team_positions!profiles_position_id_fkey(position,department),supervisor:supervisor_profile_id(full_name,role)&order=full_name.asc'+activeFilter),
    api('/rest/v1/roles?select=id,name&order=name.asc')
  ]);
  const rows=Array.isArray(r)?r:[];
  const actionHtml=x=>{
    if(profile?.role!=='owner'||x.id===session?.user?.id)return '';
    if(x.active){
      return '<button class="btn danger" data-disable-staff="'+x.id+'">Disable login</button>';
    }
    return '<button class="btn btn-dark" data-restore-staff="'+x.id+'">Enable login</button> <button class="btn danger" data-delete-staff="'+x.id+'">Delete permanently</button>';
  };
  const tableHeader='<table><tr><th>Name</th><th>Phone</th><th>Access Role</th><th>Position / Department</th><th>Employment</th><th>Reports to</th><th>Status</th><th></th></tr>';
  $('#staffTable').innerHTML=rows.length
    ? tableHeader+rows.map(x=>'<tr><td>'+esc(x.full_name)+'</td><td>'+esc(x.phone||'')+'</td><td>'+esc(x.role)+'</td><td>'+esc(x.team_positions?.position||'')+(x.team_positions?.department?' — '+esc(x.team_positions.department):'')+'</td><td>'+esc(x.employment_type||'—')+(x.pay_frequency?' / '+esc(x.pay_frequency):'')+'</td><td>'+esc(x.supervisor?.full_name||'—')+'</td><td><span class="badge">'+(x.active?'Active':'Inactive')+'</span></td><td><button class="btn" data-staff="'+x.id+'">Edit</button> <button class="btn" data-staff-security="'+x.id+'">Account security</button> '+actionHtml(x)+'</td></tr>').join('')+'</table>'
    : '<div class="state">'+(showInactiveStaff?'No inactive staff accounts.':'No active staff accounts.')+'</div>';
  document.querySelectorAll('[data-staff]').forEach(x=>x.onclick=()=>editStaff(x.dataset.staff,roles));
  document.querySelectorAll('[data-staff-security]').forEach(x=>x.onclick=()=>staffAccountSecurity(x.dataset.staffSecurity));
  document.querySelectorAll('[data-disable-staff]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Disable this staff member? Their operational history will be kept, but their login will be blocked. You can enable the account again later.'))return;
    try{
      await api('/functions/v1/remove-staff',{method:'POST',body:JSON.stringify({id:b.dataset.disableStaff,action:'disable'})});
      await loadStaff();
      showAdminToast('Staff login disabled','The account can be enabled again from Show inactive staff.');
    }catch(e){msg(e)}
  });
  document.querySelectorAll('[data-restore-staff]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Enable this staff member again? Their login will be re-enabled.'))return;
    try{
      await api('/functions/v1/remove-staff',{method:'POST',body:JSON.stringify({id:b.dataset.restoreStaff,action:'restore'})});
      await loadStaff();
      showAdminToast('Staff login enabled','The staff member can sign in again.');
    }catch(e){msg(e)}
  });
  document.querySelectorAll('[data-delete-staff]').forEach(b=>b.onclick=async()=>{
    if(!confirm('Permanently delete this staff account? This removes the login and staff profile and cannot be undone. Accounts with operational, payroll, or audit history cannot be permanently deleted.'))return;
    try{
      await api('/functions/v1/remove-staff',{method:'POST',body:JSON.stringify({id:b.dataset.deleteStaff,action:'delete'})});
      await loadStaff();
      showAdminToast('Staff account deleted','The login and staff profile were permanently removed.');
    }catch(e){msg(e)}
  });
}
async function staffAccountSecurity(id){const x=(await api('/rest/v1/profiles?id=eq.'+encodeURIComponent(id)+'&select=id,full_name'))[0];if(!x)throw Error('Staff member could not be found.');modal('Staff account security','<form id="staffSecurityForm" class="form"><label>Email<input name="email" type="email" placeholder="New email address"></label><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Leave blank to keep current password"></label><label>Confirm password<input name="confirm" type="password" minlength="8" autocomplete="new-password"></label><button class="btn btn-dark">Save account security</button><div id="staffSecurityMsg" class="notice" hidden></div></form><hr><p class="muted">Existing passwords are never displayed.</p><button id="staffRecovery" class="btn" type="button">Send password recovery email</button>');$('#staffSecurityForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),email=String(fd.get('email')||'').trim(),password=String(fd.get('password')||''),confirm=String(fd.get('confirm')||'');if(password&&password!==confirm)return alert('The new passwords do not match.');if(!email&&!password)return alert('Enter an email or new password.');const s=$('#staffSecurityMsg');try{const result=await api('/functions/v1/update-staff-account',{method:'POST',body:JSON.stringify({id,email:email||null,password:password||null})});if(s){s.hidden=false;s.textContent=result?.message||'Staff account security updated.'}}catch(err){if(s){s.hidden=false;s.className='notice danger';s.textContent=humanAdminError(err,'Staff account security could not be updated.')}}};$('#staffRecovery').onclick=async()=>{try{const result=await api('/functions/v1/update-staff-account',{method:'POST',body:JSON.stringify({id,send_recovery:true})});alert(result?.message||'Password recovery email sent.')}catch(err){msg(err)}}}
async function editStaff(id,roles){
  const x=(await api('/rest/v1/profiles?id=eq.'+encodeURIComponent(id)+'&select=*'))[0];
  if(!x)throw Error('Staff member could not be found.');
  const positions=await loadStaffPositions();
  const supervisors=await api('/rest/v1/profiles?select=id,full_name,role&active=eq.true&order=full_name.asc');
  const supervisorOptions='<option value="">No direct supervisor</option>'+supervisors.filter(s=>s.id!==id).map(s=>'<option value="'+esc(s.id)+'" '+(s.id===x.supervisor_profile_id?'selected':'')+'>'+esc(s.full_name)+' — '+esc(s.role)+'</option>').join('');
  modal('Staff profile',`
    <form id="staffForm" class="form">
      <input name="name" value="${esc(x.full_name||'')}" required>
      <input name="phone" value="${esc(x.phone||'')}">
      <label>Profile image from device
        <input name="avatar_file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif">
        <small class="muted">Choose a new image from your device, or keep/use the URL below.</small>
      </label>
      <input name="avatar_url" type="url" value="${esc(x.avatar_url||'')}" placeholder="Profile image URL">
      <textarea name="background_info" placeholder="Background information">${esc(x.background_info||'')}</textarea>
      <label>Login / Access Role<select name="role"><option value="">Choose access role</option>${roles.map(r=>'<option '+(r.name===x.role?'selected':'')+' value="'+esc(r.name)+'">'+esc(r.name)+'</option>').join('')}</select></label>
      <label>Public Website Role / Position<select name="position_id" id="staffPosition">${staffPositionOptions(positions,x.position_id)}</select></label>
      <label>Employment type<select name="employment_type">
        <option value="" ${!x.employment_type?'selected':''}>Not set</option>
        <option value="salary" ${x.employment_type==='salary'?'selected':''}>Salary</option>
        <option value="wage" ${x.employment_type==='wage'?'selected':''}>Wage / day worker</option>
        <option value="contract" ${x.employment_type==='contract'?'selected':''}>Contract</option>
        <option value="casual" ${x.employment_type==='casual'?'selected':''}>Casual</option>
      </select></label>
      <label>Pay frequency<select name="pay_frequency">
        <option value="" ${!x.pay_frequency?'selected':''}>Not set</option>
        <option value="monthly" ${x.pay_frequency==='monthly'?'selected':''}>Monthly</option>
        <option value="daily" ${x.pay_frequency==='daily'?'selected':''}>Daily</option>
        <option value="hourly" ${x.pay_frequency==='hourly'?'selected':''}>Hourly</option>
        <option value="per_shift" ${x.pay_frequency==='per_shift'?'selected':''}>Per shift</option>
      </select></label>
      <label>Reports to<select name="supervisor_profile_id">${supervisorOptions}</select></label>
      <label>Active <input name="active" type="checkbox" ${x.active?'checked':''}></label>
      <p class="muted">To change this person's login email or password, use Account security in the staff list. Existing passwords are never displayed.</p>
      <button class="btn btn-dark" type="submit">Save</button>
    </form>`);
  $('#staffForm').onsubmit=async e=>{
    e.preventDefault();
    const form=e.currentTarget,button=form.querySelector('button[type="submit"]'),f=new FormData(form),role=String(f.get('role')||'').trim();
    if(!role){msg(Error('Please choose a Login / Access Role.'));return}
    const body={
      full_name:String(f.get('name')||'').trim(),
      phone:String(f.get('phone')||'').trim()||null,
      avatar_url:String(f.get('avatar_url')||'').trim()||null,
      background_info:String(f.get('background_info')||'').trim()||null,
      role,
      position_id:String(f.get('position_id')||'').trim()||null,
      employment_type:String(f.get('employment_type')||'').trim()||null,
      pay_frequency:String(f.get('pay_frequency')||'').trim()||null,
      supervisor_profile_id:String(f.get('supervisor_profile_id')||'').trim()||null,
      active:f.get('active')==='on'
    };
    try{
      if(button){button.disabled=true;button.textContent='Saving…'}
      const avatarFile=f.get('avatar_file');
      if(avatarFile instanceof File&&avatarFile.size){
        if(avatarFile.size>52428800)throw Error('Profile image exceeds the 50 MB limit.');
        body.avatar_url=await uploadAdminImage(avatarFile,'staff');
      }
      await api('/rest/v1/rpc/admin_update_staff_profile',{method:'POST',body:JSON.stringify({
        p_target_id:id,p_full_name:body.full_name,p_phone:body.phone,p_avatar_url:body.avatar_url,
        p_background_info:body.background_info,p_role:body.role,p_position_id:body.position_id,
        p_employment_type:body.employment_type,p_pay_frequency:body.pay_frequency,
        p_supervisor_profile_id:body.supervisor_profile_id,p_active:body.active
      })});
      closeModal();await loadStaff();alert('Staff profile saved.');
    }catch(err){msg(err)}finally{if(button){button.disabled=false;button.textContent='Save'}}
  }
}
let lastAccountingCashReport=null;
function accountingDateRange(){
  const from=$('#accountingCashFrom'),to=$('#accountingCashTo');
  if(from&&!from.value)from.value=today();
  if(to&&!to.value)to.value=today();
  return {from:from?.value||today(),to:to?.value||today()};
}
async function loadAccountingCashReport(){
  const range=accountingDateRange(),from=range.from,to=range.to;
  if(from>to)throw Error('The cash report start date cannot be after the end date.');
  const source=$('#accountingCashSource')?.value||'All';
  const fetchSafe=path=>api(path).catch(err=>{console.warn('Accounting cash source unavailable',path,err);return[]});
  const [bookings,orders,events,purchases]=await Promise.all([
    fetchSafe('/rest/v1/bookings?select=id,total,booking_date,status,payment_status&booking_date=gte.'+from+'&booking_date=lte.'+to+'&status=neq.cancelled'),
    fetchSafe('/rest/v1/orders?select=id,total,created_at,status,payment_status&created_at=gte.'+from+'T00:00:00&created_at=lte.'+to+'T23:59:59&status=neq.cancelled'),
    fetchSafe('/rest/v1/events?select=id,total,event_date,status&event_date=gte.'+from+'&event_date=lte.'+to+'&status=neq.cancelled'),
    fetchSafe('/rest/v1/purchase_orders?select=id,po_number,supplier,total,created_at,status,payment_status&created_at=gte.'+from+'T00:00:00&created_at=lte.'+to+'T23:59:59&status=neq.cancelled')
  ]);
  const paid=x=>String(x?.payment_status||'').toLowerCase()==='paid';
  const rows=[
    ...orders.map(x=>({source:'Orders',id:x.id,date:x.created_at?.slice(0,10)||'',status:x.status||'',direction:paid(x)?'Money In':'Outstanding',amount:Number(x.total||0)})),
    ...bookings.map(x=>({source:'Bookings',id:x.id,date:x.booking_date||'',status:x.status||'',direction:paid(x)?'Money In':'Outstanding',amount:Number(x.total||0)})),
    ...events.map(x=>({source:'Events',id:x.id,date:x.event_date||'',status:x.status||'',direction:'Money In',amount:Number(x.total||0)})),
    ...purchases.map(x=>({source:'Purchases',id:x.po_number||x.id,date:x.created_at?.slice(0,10)||'',status:x.status||'',direction:'Money Out',amount:Number(x.total||0),supplier:x.supplier||''}))
  ].filter(x=>source==='All'||x.source===source).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  const cashIn=rows.filter(x=>x.direction==='Money In').reduce((a,x)=>a+x.amount,0);
  const cashOut=rows.filter(x=>x.direction==='Money Out').reduce((a,x)=>a+x.amount,0);
  const outstanding=rows.filter(x=>x.direction==='Outstanding').reduce((a,x)=>a+x.amount,0);
  const net=cashIn-cashOut;
  setText('#accountingCashIn','UGX '+money(cashIn));
  setText('#accountingCashOut','UGX '+money(cashOut));
  setText('#accountingCashNet','UGX '+money(net));
  setText('#accountingCashOutstanding','UGX '+money(outstanding));
  setHTML('#accountingCashTable',rows.length
    ? '<div class="table-scroll"><table><thead><tr><th>Date</th><th>Source</th><th>Status</th><th>Flow</th><th>Description</th><th>Amount</th></tr></thead><tbody>'+rows.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.source)+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.direction)+'</td><td>'+esc(x.supplier||x.id)+'</td><td>UGX '+money(x.amount)+'</td></tr>').join('')+'</tbody></table></div>'
    : '<div class="state">No transactions for the selected period.</div>');
  lastAccountingCashReport={from,to,source,rows,cashIn,cashOut,net,outstanding};
}
async function loadAccountingCash(){return loadAccountingCashReport()}
function csvCell(v){return '"'+String(v??'').replace(/"/g,'""').replace(/\r?\n/g,' ')+'"'}
function downloadTextFile(filename,textValue,mime='text/csv;charset=utf-8'){
  const blob=new Blob(['\uFEFF'+textValue],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportOperationalTable(id,title){const box=document.getElementById(id);const table=box?.querySelector('table');if(!table)return alert('Generate or refresh this report first.');const rows=[...table.querySelectorAll('tr')].map(tr=>[...tr.children].map(cell=>cell.innerText.trim().replace(/\s+/g,' ')));downloadTextFile('kiteezi-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+today()+'.csv',rows.map(row=>row.map(csvCell).join(',')).join('\r\n'));}
function printOperationalPanel(id,title){const sec=document.getElementById(id);if(!sec)return;const previous=document.title;document.title=title+' — '+today();document.querySelectorAll('.tab').forEach(x=>x.classList.remove('report-print-target'));sec.classList.add('report-print-target');window.print();setTimeout(()=>{sec.classList.remove('report-print-target');document.title=previous},500);}
function exportAccountingPanel(view){
  const panel=document.querySelector('#accounting-panel-'+view);
  if(!panel)return;
  const tables=[...panel.querySelectorAll('table')];
  if(!tables.length)return alert('Generate this report first.');
  const out=[];
  const title=(panel.querySelector('h2,h3')?.textContent||('Kiteezi '+view+' report')).trim();
  out.push([title]);
  tables.forEach((tbl,ti)=>{
    if(ti)out.push([]);
    const rows=[...tbl.querySelectorAll('tr')].map(tr=>[...tr.children].map(cell=>cell.innerText.trim().replace(/\s+/g,' ')));
    rows.forEach(row=>out.push(row));
  });
  downloadTextFile('kiteezi-'+view+'-report-'+today()+'.csv',out.map(row=>row.map(csvCell).join(',')).join('\r\n'));
}
function printAccountingPanel(view){
  const panel=document.querySelector('#accounting-panel-'+view);
  if(!panel)return;
  document.querySelectorAll('.accounting-view').forEach(p=>p.classList.remove('report-print-target'));
  panel.classList.add('report-print-target');
  window.print();
  setTimeout(()=>panel.classList.remove('report-print-target'),500);
}
function downloadAccountingCash(){
  if(!lastAccountingCashReport)return alert('Generate the cash report first.');
  const r=lastAccountingCashReport;
  const lines=[['Date','Source','Status','Flow','Description','Amount (UGX)'],...r.rows.map(x=>[x.date,x.source,x.status,x.direction,x.supplier||x.id,x.amount])];
  const csv='\\uFEFF'+lines.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\\r\\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='kiteezi-accounting-cash-'+r.from+'-to-'+r.to+'.csv';document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function printAccountingCash(){if(!lastAccountingCashReport)return alert('Generate the cash report first.');window.print()}
const PUSH_FUNCTION_URL=URL+'/functions/v1/kiteezi-push';
function pushSupported(){return 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window&&location.protocol==='https:';}
function pushB64ToBytes(value){const padding='='.repeat((4-(value.length%4))%4);const raw=atob((value+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function pushBytesToB64(buffer){const bytes=new Uint8Array(buffer);let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function registerKiteeziServiceWorker(){if(!('serviceWorker' in navigator))throw Error('This browser does not support service workers.');await navigator.serviceWorker.register('../sw.js',{scope:'../',updateViaCache:'none'});return navigator.serviceWorker.ready;}
async function getPushPublicKey(){const r=await fetch(PUSH_FUNCTION_URL,{headers:{apikey:KEY}});const d=await r.json().catch(()=>null);if(!r.ok||!d?.publicKey)throw Error(d?.error||'Push notifications are not configured yet.');return d.publicKey;}
async function currentPushSubscription(){if(!('serviceWorker' in navigator))return null;const reg=await navigator.serviceWorker.getRegistration(new window.URL('../',location.href).href);return reg?.pushManager?.getSubscription()||null;}
function setPushStatus(t,k=''){const el=$('#pushNotificationStatus');if(!el)return;el.hidden=false;el.textContent=t;el.className='notice'+(k==='error'?' danger':'');}
async function loadPushSettings(){const button=$('#enablePushNotifications'),disable=$('#disablePushNotifications');if(!button&&!disable)return;if(!pushSupported()){if(button)button.hidden=true;if(disable)disable.hidden=true;setPushStatus('Phone notifications are not supported in this browser. Use a current HTTPS browser.','error');return;}try{const sub=await currentPushSubscription();if(sub){if(button)button.hidden=true;if(disable)disable.hidden=false;setPushStatus('Phone notifications are enabled on this device.');}else{if(button)button.hidden=false;if(disable)disable.hidden=true;setPushStatus(Notification.permission==='denied'?'Notifications are blocked in this browser. Allow them in browser settings before enabling again.':'Phone notifications are not enabled on this device.');}}catch(e){setPushStatus('Unable to check phone notification status.','error');}}
async function enablePhoneNotifications(){if(!pushSupported())return setPushStatus('This browser does not support phone notifications.','error');try{const permission=await Notification.requestPermission();if(permission!=='granted')return setPushStatus('Notification permission was not granted.','error');const publicKey=await getPushPublicKey();const reg=await registerKiteeziServiceWorker();const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushB64ToBytes(publicKey)});const json=JSON.parse(JSON.stringify(sub));const body={organization_id:profile?.organization_id,user_id:session.user.id,endpoint:json.endpoint,p256dh:json.keys?.p256dh||pushBytesToB64(sub.getKey('p256dh')),auth:json.keys?.auth||pushBytesToB64(sub.getKey('auth')),updated_at:new Date().toISOString()};if(!body.organization_id)throw Error('Your staff profile has no organization assigned.');await api('/rest/v1/push_subscriptions?on_conflict=user_id%2Cendpoint',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(body)});await loadPushSettings();setPushStatus('Phone notifications are enabled. Kiteezi can now alert this device even when the site is closed.');}catch(e){console.error(e);setPushStatus(humanAdminError(e,'Could not enable phone notifications. Please try again.'),'error');}}
async function disablePhoneNotifications(){try{const sub=await currentPushSubscription();if(sub){const endpoint=sub.endpoint;await sub.unsubscribe().catch(()=>{});await api('/rest/v1/push_subscriptions?user_id=eq.'+encodeURIComponent(session.user.id)+'&endpoint=eq.'+encodeURIComponent(endpoint),{method:'DELETE'});}await loadPushSettings();}catch(e){setPushStatus(humanAdminError(e,'Could not disable phone notifications. Please try again.'),'error');}}
function canSendStaffNotifications(){return ['owner','manager','general_manager','ceo','cfo','finance_manager','reception_manager'].includes(String(profile?.role||'').toLowerCase());}
async function sendStaffNotification(){if(!canSendStaffNotifications())return msg(Error('You do not have permission to send staff notifications.'));const profiles=await api('/rest/v1/profiles?select=id,full_name,role,active,position_id,team_positions!profiles_position_id_fkey(position,department)&active=eq.true&order=full_name.asc');const roles=[...new Set(profiles.map(x=>x.role).filter(Boolean))].sort();const departments=[...new Set(profiles.map(x=>x.team_positions?.department).filter(Boolean))].sort();const personOptions=profiles.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.full_name||x.id)+' — '+esc(x.role||'staff')+(x.team_positions?.department?' — '+esc(x.team_positions.department):'')+'</option>').join('');const roleOptions=roles.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');const deptOptions=departments.map(x=>'<option value="'+esc(x)+'">'+esc(x)+'</option>').join('');modal('Send staff notification','<form id="staffNotificationForm" class="form"><label>Send to<select name="mode"><option value="person">One staff member</option><option value="role">Everyone with a role</option><option value="department">Everyone in a department</option><option value="everyone">Everyone</option></select></label><label id="staffNotificationPersonWrap">Staff member<select name="person">'+personOptions+'</select></label><label id="staffNotificationRoleWrap" hidden>Role<select name="role">'+roleOptions+'</select></label><label id="staffNotificationDepartmentWrap" hidden>Department<select name="department">'+deptOptions+'</select></label><label>Title<input name="title" maxlength="160" required></label><label>Message<textarea name="message" maxlength="2000" rows="5" required></textarea></label><button class="btn btn-dark" type="submit">Send notification</button></form>');const form=$('#staffNotificationForm'),mode=form.querySelector('[name=mode]'),pw=$('#staffNotificationPersonWrap'),rw=$('#staffNotificationRoleWrap'),dw=$('#staffNotificationDepartmentWrap');const sync=()=>{pw.hidden=mode.value!=='person';rw.hidden=mode.value!=='role';dw.hidden=mode.value!=='department'};mode.onchange=sync;sync();form.onsubmit=async e=>{e.preventDefault();const fd=new FormData(form),m=String(fd.get('mode'));let ids=[];if(m==='person')ids=[String(fd.get('person')||'')];else if(m==='role')ids=profiles.filter(x=>String(x.role)===String(fd.get('role'))).map(x=>x.id);else if(m==='department')ids=profiles.filter(x=>String(x.team_positions?.department)===String(fd.get('department'))).map(x=>x.id);else ids=profiles.map(x=>x.id);ids=[...new Set(ids)].filter(Boolean);if(!ids.length)return alert('No active staff members match that target.');try{const r=await fetch(PUSH_FUNCTION_URL,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action:'send',recipient_user_ids:ids,title:String(fd.get('title')||''),message:String(fd.get('message')||'')})});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.error||'Notification could not be sent.');closeModal();alert('Notification sent to '+d.count+' staff member'+(d.count===1?'':'s')+'.');}catch(err){msg(err)}};}
async function sendPasswordRecovery(email){const r=await fetch(URL+'/auth/v1/recover',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({email,redirect_to:location.origin+location.pathname+'?password_reset=1'})});if(!r.ok){const d=await r.json().catch(()=>null);throw Error(d?.msg||d?.message||'Password recovery could not be started.')}return true}
async function saveMyAccountSecurity(email,password){const body={};if(email)body.email=email;if(password)body.password=password;if(!Object.keys(body).length)throw Error('Enter an email or new password.');const r=await fetch(URL+'/auth/v1/user',{method:'PUT',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.msg||d?.message||'Account security changes could not be saved.');if(d?.access_token){session.access_token=d.access_token;session.refresh_token=d.refresh_token||session.refresh_token;writeAdminSession(session)}return d}
async function openMyAccountSecurity(){const u=session?.user||{};modal('My account & security','<form id="myAccountForm" class="form"><label>Email<input name="email" type="email" value="'+esc(u.email||'')+'" required></label><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Leave blank to keep current password"></label><label>Confirm new password<input name="confirm" type="password" minlength="8" autocomplete="new-password"></label><button class="btn btn-dark">Save account changes</button><div class="notice" id="myAccountStatus" hidden></div></form><hr><h3>Password recovery</h3><p class="muted">Send a recovery email to the account email address.</p><button class="btn" id="sendMyRecovery" type="button">Send recovery email</button>');$('#myAccountForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),email=String(fd.get('email')||'').trim(),pw=String(fd.get('password')||''),confirm=String(fd.get('confirm')||'');if(pw&&pw!==confirm)return alert('The new passwords do not match.');const s=$('#myAccountStatus');try{await saveMyAccountSecurity(email,pw);if(s){s.hidden=false;s.textContent='Account security updated.'}}catch(err){if(s){s.hidden=false;s.className='notice danger';s.textContent=humanAdminError(err,'Account security could not be updated.')}}};$('#sendMyRecovery').onclick=async()=>{try{await sendPasswordRecovery(String(session?.user?.email||''));alert('Password recovery email sent.')}catch(err){msg(err)}}}
function settingLabel(key){
  return String(key||'')
    .replace(/_/g,' ')
    .replace(/\b\w/g,m=>m.toUpperCase());
}
async function loadSettings(){
  if(!hasPermission('site_settings.manage')) return;
  const rows=await api('/rest/v1/site_settings?select=key,value&order=key.asc');
  const r=Array.isArray(rows)?rows:[];
  const known=new Set(Array.from(document.querySelectorAll('[data-set]')).map(x=>x.dataset.set).filter(Boolean));
  r.forEach(row=>{
    const value=row?.value??'';
    document.querySelectorAll('[data-set="'+CSS.escape(String(row.key))+'"]').forEach(el=>{
      if(el.matches('input,textarea,select')) el.value=String(value);
      else el.textContent=String(value);
    });
  });
  const logo=r.find(x=>x.key==='logo_url');
  const preview=$('#logoPreview');
  if(preview){
    const v=logo?.value||'';
    preview.src=v?(v.startsWith('http')?v:'../'+v.replace(/^\/+/,'')):'';
    preview.hidden=!v;
  }
  const extras=r.filter(x=>!known.has(String(x.key)));
  const table=$('#settingsTable');
  if(table){
    table.innerHTML=extras.length
      ? extras.map(x=>'<label><strong>'+esc(settingLabel(x.key))+'</strong><input data-set="'+esc(x.key)+'" value="'+esc(x.value||'')+'"></label>').join('')
      : '<div class="settings-empty full">No additional settings.</div>';
  }
}
async function saveSettings(){
  try{
    const logoFile=$('#logoFile')?.files?.[0];
    if(logoFile){
      if(logoFile.size>52428800)throw Error('Logo exceeds the 50 MB limit.');
      if(!['image/jpeg','image/png','image/webp','image/svg+xml'].includes(logoFile.type))throw Error('Unsupported logo type.');
      const path='branding/logo-'+crypto.randomUUID()+'.'+(logoFile.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'');
      await storageUpload('site-media',path,logoFile);
      const logoUrl=URL+'/storage/v1/object/public/site-media/'+path.split('/').map(encodeURIComponent).join('/');
      await api('/rest/v1/site_settings?key=eq.logo_url',{method:'PATCH',body:JSON.stringify({value:logoUrl,updated_at:new Date().toISOString()})});
    }
    for(const x of document.querySelectorAll('[data-set]')){
      if(x.dataset.set==='logo_url'&&logoFile)continue;
      await api('/rest/v1/site_settings?key=eq.'+encodeURIComponent(x.dataset.set),{
        method:'PATCH',
        body:JSON.stringify({value:x.value,updated_at:new Date().toISOString()})
      });
    }
    await loadSettings();
    await loadAdminLogo();
    alert('Site settings saved.');
  }catch(err){msg(err)}
}
function modal(title,body){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=body;$('#modal').classList.add('open')}
async function editStations(){const rows=await loadStations();modal('Preparation stations','<p class="muted">These stations control where menu orders are sent. Unit such as bottle/glass/shot does not determine routing.</p><div id="stationRows">'+rows.map(x=>'<div class="cardx" style="margin:8px 0"><form class="station-form" data-id="'+x.id+'"><input name="name" value="'+esc(x.name)+'" required><input name="description" value="'+esc(x.description||'')+'" placeholder="Description"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button> '+(profile?.role==='owner'?'<button type="button" class="btn danger" data-delete-station="'+x.id+'">Delete</button>':'')+'</form></div>').join('')+'</div><button type="button" class="btn" id="addStation">Add station</button>');$$('.station-form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);await api('/rest/v1/service_stations?id=eq.'+e.currentTarget.dataset.id,{method:'PATCH',body:JSON.stringify({name:fd.get('name'),description:fd.get('description')||null,active:fd.get('active')==='on'})});await editStations()});$$('[data-delete-station]').forEach(b=>b.onclick=()=>deleteBusinessRecord('service_station',b.dataset.deleteStation,editStations));$('#addStation').onclick=async()=>{await api('/rest/v1/service_stations',{method:'POST',body:JSON.stringify({name:'New Station',description:'',active:true,sort_order:rows.length+1})});await editStations()}}
function closeModal(){$('#modal').classList.remove('open');$('#modalBody').innerHTML=''}

// admin-login.js owns the login submit handler.
$('#bookingTable').addEventListener('click',handleBookingActionClick);
$('#logout').onclick=async()=>{const button=$('#logout');if(button)button.disabled=true;try{if(session?.access_token)await api('/auth/v1/logout',{method:'POST'})}catch{}finally{clearAdminSession();session=null;profile=null;location.reload()}};$('#nav').addEventListener('click',e=>{const a=e.target.closest('[data-tab]');if(a){e.preventDefault();history.replaceState(null,'','#'+a.dataset.tab);route(a.dataset.tab)}});window.addEventListener('hashchange',()=>route(location.hash.slice(1)));$('#modalClose').onclick=closeModal;$('#refreshBookings').onclick=loadBookings;$('#refreshOrders').onclick=loadOrders;$('#refreshInventory').onclick=loadInventory;$('#refreshStockRun').onclick=loadDailyStock;$('#setOpeningStock').onclick=setOpeningStock;$('#notificationBell').onclick=toggleNotifications;$('#markNotificationsRead').onclick=markNotificationsRead;$('#countStock').onclick=async()=>{const inv=await api('/rest/v1/inventory_items?select=id,name,unit&active=eq.true&order=name.asc'),d=$('#stockRunDate').value||today(),existing=await api('/rest/v1/inventory_daily_counts?select=id,inventory_item_id,physical_quantity&count_date=eq.'+d);modal('Enter physical stock count','<form id="countForm" class="form">'+inv.map(x=>{const e=existing.find(q=>q.inventory_item_id===x.id);return '<label>'+esc(x.name)+' ('+esc(x.unit)+')<input name="'+x.id+'" type="number" step="0.001" min="0" value="'+(e?.physical_quantity??'')+'"></label>'}).join('')+'<button class="btn btn-dark">Save counts</button></form>');$('#countForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);for(const x of inv){const v=f.get(x.id);if(v!==null&&v!==''){const old=existing.find(q=>q.inventory_item_id===x.id),body={inventory_item_id:x.id,count_date:d,physical_quantity:Number(v),counted_by:session.user.id};await api(old?'/rest/v1/inventory_daily_counts?id=eq.'+old.id:'/rest/v1/inventory_daily_counts',{method:old?'PATCH':'POST',body:JSON.stringify(body)})}}closeModal();loadDailyStock()}};$('#refreshPurchases').onclick=loadPurchases;$('#newStockAdjustment').onclick=addStockAdjustment;$('#refreshMenu').onclick=loadMenu;$('#refreshServices').onclick=loadServices;$('#refreshInquiries').onclick=loadInquiries;$('#refreshSwimmingTimetable').onclick=loadSwimmingTimetable;$('#refreshSwimmingSessions').onclick=loadSwimmingSessions;$('#newTask').onclick=()=>editTask();$('#refreshTasks').onclick=loadTasks;$('#newSwimmingSlot').onclick=()=>editSwimmingSlot(null);$('#refreshPages').onclick=loadContent;$('#refreshMedia').onclick=loadContent;$('#refreshAnnouncements').onclick=loadContent;$('#refreshReviews').onclick=loadReviews;$('#refreshCustomers').onclick=loadCustomers;$('#refreshSocial').onclick=loadSocial;$('#newStaff').onclick=addStaff;$('#refreshStaff').onclick=loadStaff;$('#toggleInactiveStaff').onclick=()=>{showInactiveStaff=!showInactiveStaff;$('#toggleInactiveStaff').textContent=showInactiveStaff?'Hide inactive staff':'Show inactive staff';loadStaff().catch(msg)};$('#newTeamPosition').onclick=()=>editTeamPosition();$('#refreshAccounting').onclick=loadAccounting;$('#accountingCashGenerate').onclick=()=>loadAccountingCashReport().catch(msg);document.querySelectorAll('[data-report-export]').forEach(b=>b.onclick=()=>exportAccountingPanel(b.dataset.reportExport));document.querySelectorAll('[data-report-print]').forEach(b=>b.onclick=()=>printAccountingPanel(b.dataset.reportPrint));$('#accountingCashDownload').onclick=downloadAccountingCash;$('#accountingCashPrint').onclick=printAccountingCash;$('#refreshSettings').onclick=loadSettings;$('#enablePushNotifications')?.addEventListener('click',enablePhoneNotifications);$('#disablePushNotifications')?.addEventListener('click',disablePhoneNotifications);$('#sendStaffNotification')?.addEventListener('click',()=>sendStaffNotification().catch(msg));$('#refreshRoles').onclick=loadRolesAndPermissions;$('#accountingSubnav')?.addEventListener('click',e=>{const b=e.target.closest('[data-accounting-view]');if(!b)return;loadAccountingView(b.dataset.accountingView).catch(msg)});$('#saveSettings').onclick=saveSettings;$('#openMyAccountSecurity')?.addEventListener('click',()=>openMyAccountSecurity().catch(msg));$('#newRequisition').onclick=()=>createRequisition();$('#refreshRequisitions').onclick=loadRequisitions;$('#refreshGeneratedPOs').onclick=loadGeneratedPOs;$('#newServiceLog').onclick=()=>newServiceLog();$('#refreshServiceTally').onclick=loadServiceTally;document.getElementById('newOrder')?.addEventListener('click',()=>{route('restaurant');posClear();setupPos();loadPosMenu().catch(msg)});$('#newSocial').onclick=()=>editSocial();$('#newInventoryItem').onclick=()=>editInventory();$('#manageStations').onclick=editStations;$('#inventorySearch').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#inventoryTable tbody tr').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(q)?'':'none')};$('#newMenu').onclick=()=>editMenu(); $('#inventorySubnav')?.addEventListener('click',e=>{const b=e.target.closest('[data-inv-tab]');if(!b)return;document.querySelectorAll('#inventorySubnav [data-inv-tab]').forEach(x=>x.classList.toggle('active',x===b));const key=b.dataset.invTab;document.querySelectorAll('[id^="inventory-panel-"]').forEach(x=>x.style.display=x.id==='inventory-panel-'+key?'block':'none');const loaders={items:loadInventory,daily:loadDailyStock,purchases:loadPurchases,movements:loadStockMovements,recipes:loadRecipeMappings};(loaders[key]||loadInventory)().catch(msg)}); document.querySelectorAll('[id^="inventory-panel-"]').forEach(x=>x.style.display=x.id==='inventory-panel-items'?'block':'none');$('#newService').onclick=()=>editService();$('#newSport').onclick=()=>editSport();$('#newMedia').onclick=addMedia;$('#newGalleryMedia').onclick=addGalleryMedia;$('#refreshGallery').onclick=loadGallery;$('#newAnnouncement').onclick=addAnnouncement;setupPos();setupOrderViews();setOrderView('orders');restore();