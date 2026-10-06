'use strict';
const C=window.KITEEZI_CONFIG||{}, URL=String(C.SUPABASE_URL||'').replace(/\/+$/,''), KEY=String(C.SUPABASE_ANON_KEY||'');
let session=null,profile=null,tab='dashboard',permissions=new Set();
const TAB_PERMISSIONS={
  dashboard:'dashboard.view', bookings:'bookings.manage', restaurant:'orders.manage',
  inventory:'inventory.operational', menu:'menu.manage', services:'services.manage',
  inquiries:'inquiries.view', swimming_timetable:'swimming.manage', swimming_sessions:'swimming.assigned', tasks:'tasks.manage', content:'content.manage', gallery:'gallery.view',
  reviews:'reviews.view', social:'social.manage', staff:'staff.manage',
  reports:'reports.view', settings:'site_settings.manage', requisitions:'requisitions.view', purchases:'purchase_orders.view', service_tally:'service_logs.create'
};
const TAB_FALLBACK_PERMISSIONS={
  bookings:['bookings.view'],
  inventory:['inventory.all','inventory.operational','inventory.kitchen','inventory.bar','inventory.cleaning','inventory.swimming'],
  restaurant:['orders.manage','orders.station_kitchen','orders.station_barista','orders.reception.view'],
  menu:['menu.manage','menu.public_content.manage'],
  inquiries:['inquiries.view','inquiries.catering','inquiries.drinks','inquiries.general','inquiries.swimming'],
  swimming_sessions:['swimming.manage','swimming.assigned'],
  reports:['reports.view','reports.reservations.view']
};
const hasPermission=code=>profile?.role==='owner'||permissions.has(code);
const canSeeTab=name=>hasPermission(TAB_PERMISSIONS[name])||(TAB_FALLBACK_PERMISSIONS[name]||[]).some(hasPermission);

const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const setHTML=(s,v)=>{const el=$(s);if(el)el.innerHTML=v;};
const setText=(s,v)=>{const el=$(s);if(el)el.textContent=v;};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>new Intl.NumberFormat('en-UG').format(Number(v)||0);
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
  if(!r.ok)throw Error(d?.message||d?.msg||d?.error_description||d?.error||(typeof d==='string'?d:'Request failed'));
  return d;
}
function msg(e){console.error(e);alert(e.message||'Something went wrong.')}
// Login is handled exclusively by admin-login.js to avoid duplicate submit handlers. 
async function loadStations(){return api('/rest/v1/service_stations?select=id,name,description,active,sort_order&order=sort_order.asc,name.asc')}
let UNIT_OPTIONS=[];
async function loadUnitOptions(){if(UNIT_OPTIONS.length)return UNIT_OPTIONS;const rows=await api('/rest/v1/unit_options?select=code,label,category&active=eq.true&order=sort_order.asc,label.asc');UNIT_OPTIONS=Array.isArray(rows)?rows:[];return UNIT_OPTIONS}
function unitOptionsHtml(selected=''){const v=String(selected||'').toLowerCase();return '<option value="">Choose unit</option>'+UNIT_OPTIONS.map(u=>'<option value="'+esc(u.code)+'" '+(u.code===v?'selected':'')+'>'+esc(u.label)+'</option>').join('')}
async function bootAdmin(authSession){
  try{
    session=authSession||JSON.parse(sessionStorage.getItem('kiteezi_admin_session')||'null');
    if(!session?.access_token||!session?.user?.id)throw Error('No valid admin session.');
    sessionStorage.setItem('kiteezi_admin_session',JSON.stringify(session));
    const p=await api('/rest/v1/profiles?select=*&id=eq.'+encodeURIComponent(session.user.id)+'&limit=1');
    profile=p?.[0];
    if(!profile?.active)throw Error('This Kiteezi staff profile is inactive.');
    try{await show()}catch(e){
      console.error('Kiteezi admin display initialization error:',e);
      $('#loginView')?.classList.add('hide');
      $('#app')?.classList.remove('hide');
      if($('#who'))$('#who').textContent=(profile.full_name||'Staff')+' · '+(profile.role||'staff');
      if($('#rolePill'))$('#rolePill').textContent=profile.role||'staff';
      const dash=$('#dashboard'); if(dash)dash.classList.add('active');
      document.querySelectorAll('.tab').forEach(x=>{if(x.id!=='dashboard')x.classList.remove('active')});
      if($('#todayOps'))$('#todayOps').textContent='Dashboard opened. Some live data could not be loaded yet.';
    }
    return true;
  }catch(e){
    console.error('Kiteezi admin boot failed:',e);
    const authFailure=!session?.user?.id;
    if(authFailure){
      session=null;
      sessionStorage.removeItem('kiteezi_admin_session');
    }
    $('#app')?.classList.add('hide');
    $('#loginView')?.classList.remove('hide');
    const el=$('#loginMsg'); if(el){el.hidden=false;el.textContent=e.message||'Unable to open the admin dashboard.';el.className='notice danger'}
    return false;
  }
}
window.KITEEZI_ADMIN_BOOT=bootAdmin;
async function restore(){
  const raw=sessionStorage.getItem('kiteezi_admin_session');
  if(!raw){$('#loginView').classList.remove('hide');return}
  let saved;try{saved=JSON.parse(raw)}catch{saved=null}
  if(!saved?.access_token){$('#loginView').classList.remove('hide');return}
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
async function show(){
  $('#loginView')?.classList.add('hide');
  $('#app')?.classList.remove('hide');
  if($('#who'))$('#who').textContent=(profile?.full_name||'Staff')+' · '+(profile?.role||'staff');
  if($('#rolePill'))$('#rolePill').textContent=profile?.role||'staff';
  try{loadAdminLogo()}catch(e){console.warn('Admin logo load failed',e)}
  try{loadNotifications().catch(()=>{});startNotificationPolling()}catch(e){console.warn('Admin notifications unavailable',e)}
  try{await loadPermissions()}catch(e){console.warn('Admin permissions load failed',e);permissions=new Set()}
  try{applyRoleNavigation()}catch(e){console.warn('Admin navigation setup failed',e)}
  try{history.replaceState(null,'','#dashboard');route('dashboard')}catch(e){
    console.error('Admin route initialization failed:',e);
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    $('#dashboard')?.classList.add('active');
    if($('#todayOps'))$('#todayOps').textContent='Dashboard opened. Live data is still loading.';
  }
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
    ['restaurant','POS / Orders',['orders.view','orders.manage','orders.station_kitchen','orders.station_barista','orders.reception.view']],
    ['bookings','Bookings',['bookings.view','bookings.manage']],
    ['inventory','Inventory',['inventory.all','inventory.operational','inventory.manage','inventory.kitchen','inventory.bar','inventory.cleaning','inventory.swimming']],
    ['menu','Menu',['menu.manage','menu.public_content.manage']],
    ['services','Services',['services.manage']],
    ['inquiries','Inquiries',['inquiries.view','inquiries.catering','inquiries.drinks','inquiries.general','inquiries.swimming']],
    ['swimming_timetable','Swimming Timetable',['swimming.manage']],
    ['swimming_sessions','Swimming Sessions',['swimming.assigned','swimming.manage']],
    ['tasks','Grounds / Tasks',['tasks.manage']],
    ['content','Content / Media',['content.manage']],
    ['gallery','Gallery',['gallery.view','gallery.moderate','gallery.manage','gallery.upload']],
    ['reviews','Reviews',['reviews.view','reviews.moderate']],
    ['social','Social Links',['social.manage']],
    ['staff','Staff / Roles',['staff.manage']],
    ['reports','Reports',['reports.view','reports.reservations.view']],
    ['requisitions','Requisitions',['requisitions.view','requisitions.create','requisitions.approve.manager','requisitions.approve.gm','requisitions.approve.ceo']],
    ['purchases','Purchase Orders',['purchase_orders.view','purchase_orders.manage']],
    ['service_tally','Service Tally',['service_logs.create']],
    ['settings','Settings',['site_settings.manage']]
  ];
  if(nav){
    const visibleTree=modules.filter(([,label,needed])=>Array.isArray(needed)&&needed.some(hasPermission));
    nav.innerHTML=visibleTree.map(([id,label])=>'<a href="#'+id+'" data-tab="'+id+'">'+label+'</a>').join('');
  }
  const staffHelp=$('#staffHelp'); if(staffHelp&&!hasPermission('staff.manage'))staffHelp.textContent='Staff accounts are managed by the owner or authorized managers.';
  const newMenu=$('#newMenu'); if(newMenu)newMenu.hidden=!hasPermission('menu.manage');
  const newReq=$('#newRequisition'); if(newReq)newReq.hidden=!hasPermission('requisitions.create');
  const newOrder=$('#newOrder'); if(newOrder)newOrder.hidden=!hasPermission('orders.manage');
  const newInv=$('#newInventoryItem'); if(newInv)newInv.hidden=!hasPermission('inventory.manage');
  const newTask=$('#newTask'); if(newTask)newTask.hidden=!hasPermission('tasks.manage');
  const newServiceLogBtn=$('#newServiceLog'); if(newServiceLogBtn)newServiceLogBtn.hidden=!hasPermission('service_logs.create');
  const actionPermissions={newOrder:'orders.manage',newInventoryItem:'inventory.manage',newTask:'tasks.manage',newSwimmingSlot:'swimming.manage',newMedia:'content.manage',newAnnouncement:'content.manage',newSocial:'social.manage',newStaff:'staff.manage',newTeamPosition:'site_settings.manage',newService:'services.manage',newSport:'services.manage',newRequisition:'requisitions.create',newServiceLog:'service_logs.create',newGalleryMedia:'gallery.upload',saveSettings:'site_settings.manage'};
  Object.entries(actionPermissions).forEach(([id,perm])=>{const el=$('#'+id);if(el)el.hidden=!hasPermission(perm)});
  const purchaseSubnav=document.querySelector('[data-inv-tab="purchases"]');
  if(purchaseSubnav)purchaseSubnav.hidden=!(hasPermission('purchase_orders.view')||hasPermission('purchase_orders.manage'));


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
  const canManage=profile?.role==='owner'||profile?.role==='ceo'||profile?.role==='general_manager'||profile?.role==='head_swimming_coach';
  $('#swimmingSessionsTable').innerHTML=rows.length
    ? '<table><tr><th>Session</th><th>Type</th><th>School</th><th>Coach</th><th>Attendance</th><th>Notes</th><th></th></tr>'+
      rows.map(x=>'<tr><td>'+esc(x.id.slice(0,8).toUpperCase())+'</td><td>'+esc(x.session_type||'')+'</td><td>'+esc(x.school_name||'')+'</td><td>'+esc(x.coach_id||'Unassigned')+'</td><td>'+esc(x.attendance_count??0)+'</td><td>'+esc(x.notes||'')+'</td><td><button class="btn" data-edit-session="'+x.id+'">Update</button></td></tr>').join('')+'</table>'
    : '<div class="state">No assigned swimming sessions.</div>';
  $$('[data-edit-session]').forEach(b=>b.onclick=()=>editSwimmingSession(rows.find(x=>x.id===b.dataset.editSession),canManage));
}
async function editSwimmingSession(row,canManage){
  if(!row)return;
  modal('Swimming session','<form id="sessionForm" class="form">'+
    (canManage?'<label>Session type<input name="type" value="'+esc(row.session_type||'')+'" required></label><label>School / group<input name="school" value="'+esc(row.school_name||'')+'"></label>':'')+
    '<label>Attendance<input name="attendance" type="number" min="0" value="'+esc(row.attendance_count??0)+'"></label><label>Notes<textarea name="notes">'+esc(row.notes||'')+'</textarea></label><button class="btn btn-dark">Save</button></form>');
  $('#sessionForm').onsubmit=async e=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const body={attendance_count:Number(f.get('attendance')||0),notes:f.get('notes')||null};
    if(canManage){body.session_type=f.get('type');body.school_name=f.get('school')||null;}
    try{await api('/rest/v1/swimming_sessions?id=eq.'+encodeURIComponent(row.id),{method:'PATCH',body:JSON.stringify(body)});closeModal();await loadSwimmingSessions();}catch(err){msg(err)}
  };
}
async function loadTasks(){
  const rows=await api('/rest/v1/staff_tasks?select=id,assigned_to,title,description,due_date,status,created_at&order=due_date.asc.nullsfirst,created_at.desc');
  const canEdit=hasPermission('tasks.manage')||hasPermission('staff.manage');
  $('#tasksTable').innerHTML=rows.length
    ? '<table><tr><th>Task</th><th>Description</th><th>Due</th><th>Status</th><th>Assigned</th><th></th></tr>'+
      rows.map(x=>'<tr><td>'+esc(x.title)+'</td><td>'+esc(x.description||'')+'</td><td>'+esc(x.due_date||'—')+'</td><td>'+esc(x.status||'open')+'</td><td>'+esc(x.assigned_to||'Unassigned')+'</td><td>'+(canEdit?'<button class="btn" data-edit-task="'+x.id+'">Edit</button>':'')+'</td></tr>').join('')+'</table>'
    : '<div class="state">No facility tasks.</div>';
  $$('[data-edit-task]').forEach(b=>b.onclick=()=>editTask(rows.find(x=>x.id===b.dataset.editTask)));
}
async function editTask(row=null){
  const x=row||{title:'',description:'',due_date:'',status:'open',assigned_to:null};
  modal(row?'Edit task':'Add task','<form id="taskForm" class="form"><input name="title" value="'+esc(x.title)+'" placeholder="Task title" required><textarea name="description" placeholder="Description / checklist">'+esc(x.description||'')+'</textarea><input name="due" type="date" value="'+esc(x.due_date||'')+'"><select name="status"><option '+(x.status==='open'?'selected':'')+'>open</option><option '+(x.status==='in_progress'?'selected':'')+'>in_progress</option><option '+(x.status==='completed'?'selected':'')+'>completed</option></select><button class="btn btn-dark">Save task</button></form>');
  $('#taskForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={title:f.get('title'),description:f.get('description')||null,due_date:f.get('due')||null,status:f.get('status')};try{await api(row?'/rest/v1/staff_tasks?id=eq.'+row.id:'/rest/v1/staff_tasks',{method:row?'PATCH':'POST',body:JSON.stringify(body)});closeModal();await loadTasks()}catch(err){msg(err)}};
}

async function loadSwimmingTimetable(){
  const rows=await api('/rest/v1/swimming_timetable?select=*&order=day_of_week.asc,start_time.asc');
  const days=['','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  $('#swimmingTimetableTable').innerHTML='<table><tr><th>Day</th><th>Start</th><th>End</th><th>Public display</th><th>Action</th></tr>'+
    rows.map(x=>'<tr><td>'+days[x.day_of_week]+'</td><td>'+String(x.start_time).slice(0,5)+'</td><td>'+String(x.end_time).slice(0,5)+'</td><td><span class="pill">Occupied</span></td><td><button class="btn" data-edit-swim="'+x.id+'">Edit</button> <button class="btn danger" data-delete-swim="'+x.id+'">Remove</button></td></tr>').join('')+'</table>';
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
      const deleteBtn=profile?.role==='owner'?'<button class="btn danger" data-delete-inquiry="'+x.id+'">Delete</button> ':'';return '<tr><td>'+esc(new Date(x.created_at).toLocaleString())+'</td><td>'+esc(x.customer_name)+'</td><td>'+esc(x.contact_number)+'<br><small>'+esc(x.contact_method)+'</small></td><td>'+esc(x.inquiry_type)+'</td><td>'+esc(x.message)+'</td><td>'+deleteBtn+'<select data-inquiry-status="'+x.id+'"><option '+(x.status==='new'?'selected':'')+'>new</option><option '+(x.status==='in_progress'?'selected':'')+'>in_progress</option><option '+(x.status==='replied'?'selected':'')+'>replied</option><option '+(x.status==='closed'?'selected':'')+'>closed</option></select></td><td><div class="actions"><a class="btn" href="https://wa.me/'+wa+'?text='+msgText+'" target="_blank" rel="noopener">WhatsApp</a><a class="btn" href="tel:'+num+'">Call</a></div></td></tr>';
    }).join('')+'</table>':'<div class="state">No inquiries for your role.</div>';
  document.querySelectorAll('#inquiriesTable [data-delete-inquiry]').forEach(x=>x.onclick=()=>deleteTestRecord('inquiry',x.dataset.deleteInquiry));document.querySelectorAll('#inquiriesTable [data-inquiry-status]').forEach(el=>el.onchange=async()=>{await api('/rest/v1/inquiries?id=eq.'+encodeURIComponent(el.dataset.inquiryStatus),{method:'PATCH',body:JSON.stringify({status:el.value,updated_at:new Date().toISOString()})});});
}
let notificationInitialized=false;let notificationIds=new Set();let notificationCache=new Map();let notificationPoll=null;function showAdminToast(title,message){let t=document.getElementById('adminToast');if(!t){t=document.createElement('div');t.id='adminToast';t.style.cssText='position:fixed;right:18px;bottom:18px;z-index:200;background:#1b4332;color:#fff;padding:14px 16px;border-radius:12px;box-shadow:0 8px 30px #0003;max-width:360px';document.body.appendChild(t)}t.innerHTML='<strong>'+esc(title)+'</strong><div style="margin-top:4px">'+esc(message||'')+'</div>';setTimeout(()=>t.remove(),7000);}function notificationTarget(n){const t=String(n.reference_type||'').toLowerCase();if(t==='booking'||t==='bookings')return 'bookings';if(t==='order'||t==='orders')return 'restaurant';if(t==='review'||t==='reviews')return 'reviews';if(t==='inquiry'||t==='inquiries')return 'inquiries';return 'dashboard'}
async function openNotification(n){const target=notificationTarget(n);if(n.id){await api('/rest/v1/notifications?id=eq.'+encodeURIComponent(n.id),{method:'PATCH',body:JSON.stringify({is_read:true})});await loadNotifications();}if(n.reference_id&&target==='bookings'){history.replaceState(null,'','#bookings');route('bookings');setTimeout(()=>{const row=document.querySelector('[data-b="'+CSS.escape(n.reference_id)+'"]');if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.closest('tr')?.classList.add('highlight')}} ,100);return}history.replaceState(null,'','#'+target);route(target)}
async function loadNotifications(){if(!session?.user?.id)return;const rows=await api('/rest/v1/notifications?select=id,title,message,is_read,created_at,reference_type,reference_id&recipient_user_id=eq.'+session.user.id+'&is_read=eq.false&order=created_at.desc&limit=30');if(notificationInitialized){rows.filter(x=>!notificationIds.has(x.id)).reverse().forEach(x=>showAdminToast(x.title,x.message));}notificationIds=new Set(rows.map(x=>x.id));notificationCache=new Map(rows.map(x=>[x.id,x]));notificationInitialized=true;bindNotificationClicks();const unread=rows.filter(x=>!x.is_read).length;$('#notificationCount').textContent=String(unread);$('#notificationList').innerHTML=rows.length?rows.map(x=>'<div class="cardx notification-item" data-notification="'+esc(x.id)+'" style="margin-bottom:8px;cursor:pointer;opacity:'+(x.is_read?'0.7':'1')+'"><strong>'+esc(x.title)+'</strong><div>'+esc(x.message||'')+'</div><small class="muted">'+esc(new Date(x.created_at).toLocaleString())+'</small></div>').join(''):'<div class="state">No notifications.</div>';}
function toggleNotifications(){const p=$('#notificationPanel');p.style.display=p.style.display==='none'?'block':'none';if(p.style.display==='block')loadNotifications().catch(msg)}
function startNotificationPolling(){if(notificationPoll)clearInterval(notificationPoll);notificationPoll=setInterval(()=>{if(!document.hidden)loadNotifications().catch(()=>{});},10000);}
function bindNotificationClicks(){document.querySelectorAll('.notification-item').forEach(el=>el.onclick=async()=>{try{const n=notificationCache.get(el.dataset.notification);if(n)await openNotification(n);}catch(e){msg(e)}})}
async function markNotificationsRead(){await api('/rest/v1/notifications?recipient_user_id=eq.'+session.user.id+'&is_read=eq.false',{method:'PATCH',body:JSON.stringify({is_read:true})});await loadNotifications()}
async function loadRequisitions(){
  const rows=await api('/rest/v1/requisitions?select=*,requisition_items(*,inventory_items(name,unit))&order=created_at.desc');
  const role=String(profile?.role||'').toLowerCase();
  const canManager=hasPermission('requisitions.approve.manager');
  const canGM=hasPermission('requisitions.approve.gm');
  const canCEO=hasPermission('requisitions.approve.ceo');
  $('#requisitionsTable').innerHTML=rows.length?'<table><tr><th>Number</th><th>Requester</th><th>Status</th><th>Items</th><th>Action</th></tr>'+
    rows.map(r=>{
      const items=(r.requisition_items||[]).map(i=>esc(i.inventory_items?.name||i.inventory_item_id)+' × '+esc(i.quantity)).join('<br>');
      let actions='';
      if(r.status==='manager_pending'&&canManager) actions='<button class="btn" data-req-approve="'+r.id+'" data-stage="manager">Confirm</button> <button class="btn" data-req-edit="'+r.id+'">Edit</button> <button class="btn danger" data-req-reject="'+r.id+'">Reject</button>';
      if(r.status==='gm_pending'&&canGM) actions='<button class="btn" data-req-approve="'+r.id+'" data-stage="gm">Confirm</button> <button class="btn" data-req-edit="'+r.id+'">Edit</button> <button class="btn danger" data-req-reject="'+r.id+'">Reject</button>';
      if(r.status==='ceo_pending'&&canCEO) actions='<button class="btn" data-req-approve="'+r.id+'" data-stage="ceo">Confirm & Generate PO</button> <button class="btn" data-req-edit="'+r.id+'">Edit</button> <button class="btn danger" data-req-reject="'+r.id+'">Reject</button>';
      return '<tr><td>'+esc(r.requisition_number)+'</td><td>'+esc(r.requester_id)+'</td><td>'+esc(r.status)+'</td><td>'+items+'</td><td class="actions">'+actions+'</td></tr>';
    }).join('')+'</table>':'<div class="state">No requisitions.</div>';
  $$('[data-req-approve]').forEach(b=>b.onclick=async()=>{try{await api('/rest/v1/rpc/approve_requisition',{method:'POST',body:JSON.stringify({p_requisition_id:b.dataset.reqApprove,p_action:'approved'})});await loadRequisitions();loadGeneratedPOs().catch(()=>{});}catch(e){msg(e)}});
  $$('[data-req-edit]').forEach(b=>b.onclick=()=>editRequisition(b.dataset.reqEdit));
  $$('[data-req-reject]').forEach(b=>b.onclick=async()=>{const reason=prompt('Reason for rejection (required):');if(!reason?.trim())return;try{await api('/rest/v1/rpc/approve_requisition',{method:'POST',body:JSON.stringify({p_requisition_id:b.dataset.reqReject,p_action:'rejected',p_reason:reason.trim()})});await loadRequisitions();}catch(e){msg(e)}});
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
    rows.map(x=>'<tr><td>'+esc(x.po_number||x.id.slice(0,8).toUpperCase())+'</td><td>'+esc(x.reference||x.requisition_id||'')+'</td><td>'+esc(x.status||'ordered')+'</td><td>'+esc(x.supplier||'')+'</td><td>UGX '+money(x.total)+'</td><td>'+esc(x.payment_status||'unpaid')+'</td><td>'+esc(x.received_at?new Date(x.received_at).toLocaleString():'Not received')+'</td><td class="actions">'+
      (canManage&&x.status!=='received'&&x.status!=='cancelled'?'<button class="btn" data-po-receive="'+x.id+'">Receive</button> ':'')+
      (canManage&&x.payment_status!=='paid'&&x.status!=='cancelled'?'<button class="btn" data-po-paid="'+x.id+'">Mark paid</button> ':'')+
      (profile?.role==='owner'?'<button class="btn danger" data-delete-po="'+x.id+'">Delete test</button>':'')+
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
  modal('New requisition','<form id="newReqForm" class="form"><textarea name="notes" placeholder="Reason / notes"></textarea><div id="newReqLines">'+line()+'</div><button type="button" class="btn" id="addNewReqLine">Add item</button> <button class="btn btn-dark">Submit to Manager</button></form>');
  $('#addNewReqLine').onclick=()=>$('#newReqLines').insertAdjacentHTML('beforeend',line());
  $('#newReqForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const items=[...e.currentTarget.querySelectorAll('.req-new-line')].map(row=>({inventory_item_id:row.querySelector('[name=item]').value,quantity:Number(row.querySelector('[name=qty]').value||0),unit_code:row.querySelector('[name=unit]').value,estimated_unit_price:Number(row.querySelector('[name=price]').value||0)})).filter(x=>x.quantity>0);if(!items.length)return alert('Add at least one item.');try{await api('/rest/v1/rpc/create_requisition',{method:'POST',body:JSON.stringify({p_items:items,p_notes:f.get('notes')||null})});closeModal();await loadRequisitions();}catch(err){msg(err)}};
}
async function loadServiceTally(){
  const rows=await api('/rest/v1/service_logs?select=id,staff_id,item_id,quantity,recorded_at&order=recorded_at.desc&limit=200');
  setHTML('#serviceTallyTable',rows.length?'<table><tr><th>When</th><th>Staff</th><th>Menu item</th><th>Quantity</th></tr>'+rows.map(x=>'<tr><td>'+esc(x.recorded_at)+'</td><td>'+esc(x.staff_id)+'</td><td>'+esc(x.item_id)+'</td><td>'+esc(x.quantity)+'</td></tr>').join('')+'</table>':'<div class="state">No service tallies recorded.</div>');
}
async function newServiceLog(){
  const items=await api('/rest/v1/menu_items?select=id,name&order=name.asc');
  modal('Record service tally','<form id="serviceLogForm" class="form"><select name="item" required>'+items.map(x=>'<option value="'+x.id+'">'+esc(x.name)+'</option>').join('')+'</select><input name="qty" type="number" min="0.001" step="0.001" required placeholder="Quantity served"><p class="muted">This entry is reporting/accounting data only. It does not change physical inventory.</p><button class="btn btn-dark">Record</button></form>');
  $('#serviceLogForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await api('/rest/v1/rpc/record_service_log',{method:'POST',body:JSON.stringify({p_item_id:f.get('item'),p_quantity:Number(f.get('qty'))})});closeModal();await loadServiceTally();}catch(err){msg(err)}};
}

function route(x){
  const requested=x||'dashboard';
  tab=canOpenTab(requested)?requested:(canOpenTab('dashboard')?'dashboard':Object.keys(TAB_PERMISSIONS).find(canOpenTab)||'dashboard');
  document.querySelectorAll('[data-tab]').forEach(a=>a.classList.toggle('active',a.dataset.tab===tab));
  document.querySelectorAll('.tab').forEach(sec=>{
    const active=sec.id===tab;
    sec.classList.toggle('active',active);
    sec.hidden=!active;
    sec.setAttribute('aria-hidden',active?'false':'true');
  });
  const f={dashboard:loadDashboard,bookings:loadBookings,restaurant:loadOrders,inventory:loadInventory,menu:loadMenu,services:loadServices,inquiries:loadInquiries,swimming_timetable:loadSwimmingTimetable,swimming_sessions:loadSwimmingSessions,tasks:loadTasks,content:loadContent,gallery:loadGallery,reviews:loadReviews,social:loadSocial,staff:loadStaff,reports:loadReport,settings:loadSettings,requisitions:loadRequisitions,purchases:loadGeneratedPOs,service_tally:loadServiceTally};
  Promise.resolve((f[tab]||loadDashboard)()).catch(msg);
}
async function loadDashboard(){const d=today();const [b,o,i,sm]=await Promise.all([api('/rest/v1/bookings?select=id,status&booking_date=eq.'+d),api('/rest/v1/orders?select=id,status&status=not.eq.completed&status=not.eq.cancelled'),api('/rest/v1/inventory_items?select=id,reorder_level'),api('/rest/v1/stock_movements?select=item_id,quantity,movement_type')]);const stock={};sm.forEach(x=>stock[x.item_id]=(stock[x.item_id]||0)+(String(x.movement_type).toLowerCase()==='out'?-1:1)*Number(x.quantity||0));$('#mBookings').textContent=b.length;$('#mPending').textContent=b.filter(x=>x.status==='pending').length;$('#mOrders').textContent=o.length;$('#mLow').textContent=i.filter(x=>(stock[x.id]||0)<=Number(x.reorder_level||0)).length;$('#todayOps').textContent='Live data connected.'}
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
async function deleteTestRecord(type,id){if(profile?.role!=='owner')return;const labels={booking:'booking',order:'order',inquiry:'inquiry',purchase_order:'purchase order',stock_movement:'stock movement',menu_recipe:'recipe'};const label=labels[type]||'record';if(!confirm('Delete this test '+label+' permanently? This cannot be undone.'))return;try{await api('/rest/v1/rpc/owner_delete_test_record',{method:'POST',body:JSON.stringify({p_type:type,p_id:id})});if(type==='booking')await loadBookings();else if(type==='order')await loadOrders();else if(type==='inquiry')await loadInquiries();else if(type==='purchase_order')await loadPurchases();else if(type==='stock_movement')await loadStockMovements();}catch(e){msg(e)}}
async function loadBookings(){
  const filter=$('#bookingFilter')?.value||'all';
  let q='/rest/v1/bookings?select=*,customers(name,phone),services(name)&order=booking_date.desc,start_time.asc';
  if(filter!=='all')q+='&status=eq.'+encodeURIComponent(filter);
  let rows=await api(q);
  if(['head_swimming_coach','swimming_coach'].includes(String(profile?.role||'')))rows=rows.filter(r=>/swim/i.test(r.services?.name||'')||r.booking_type==='school_swimming');
  const todayDate=today();
  const todayRows=rows.filter(r=>String(r.booking_date)===todayDate);
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
        const confirmBtn=actionAllowed('bookings.confirm')&&r.status==='pending'?'<button class="btn" data-confirm-booking="'+r.id+'" data-wa="'+num+'" data-watext="'+waText+'">Confirm</button> ':'';
        const paidBtn=actionAllowed('bookings.pay')&&r.payment_status!=='paid'&&r.status!=='cancelled'?'<button class="btn" data-paid-booking="'+r.id+'">Paid</button> ':'';
        const completeBtn=actionAllowed('bookings.complete')&&active?'<button class="btn" data-complete-booking="'+r.id+'">Completed</button> ':'';
        const cancelBtn=actionAllowed('bookings.cancel')&&active?'<button class="btn" data-cancel-booking="'+r.id+'">Cancel</button> ':'';
        const deleteBtn=hasPermission('bookings.delete')?'<button class="btn danger" data-delete-booking="'+r.id+'">Delete</button> ':'';
        return '<tr><td>'+esc(r.booking_date)+' '+esc(r.start_time||'')+'</td><td>'+esc(customer)+'<br>'+esc(r.customers?.phone||'')+'</td><td>'+esc(r.people)+'</td><td>UGX '+money(r.total)+'</td><td>'+esc(r.status)+'</td><td>'+esc(r.payment_status||'unpaid')+'</td><td class="actions">'+confirmBtn+paidBtn+completeBtn+cancelBtn+deleteBtn+'</td></tr>';
      }).join('')+'</table>';
  };
  setHTML('#bookingTable','<h3>Today\'s bookings</h3>'+renderRows(todayRows)+'<h3 style="margin-top:24px">Previous bookings</h3>'+renderRows(previousRows));
}
async function setBookingStatus(id,status,payment){
  try{
    await api('/rest/v1/rpc/admin_update_booking',{method:'POST',body:JSON.stringify({p_booking_id:id,p_status:status||null,p_payment_status:payment||null})});
    await loadBookings();
  }catch(e){msg(e)}
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
  const rows=await api('/rest/v1/rpc/get_station_order_workflow',{method:'POST',body:JSON.stringify({p_station:station})});
  const filter=$('#orderStatusFilter')?.value||'all';
  const visible=(rows||[]).filter(x=>filter==='all'||x.order_status===filter);
  $('#ordersTable').innerHTML=visible.length
    ? '<table><tr><th>Order</th><th>Customer</th><th>Fulfillment</th><th>Order Status</th><th>Station</th><th>Station Progress</th><th>Action</th></tr>'+
      visible.map(r=>{
        const label=r.station_status==='waiting'?'Waiting':r.station_status==='in_progress'?'In Progress':'Complete';
        const action=r.order_status==='confirmed'
          ? '<select data-station-status="'+r.order_id+'" data-station-id="'+r.station_id+'"><option value="waiting" '+(r.station_status==='waiting'?'selected':'')+'>Waiting</option><option value="in_progress" '+(r.station_status==='in_progress'?'selected':'')+'>In Progress</option><option value="complete" '+(r.station_status==='complete'?'selected':'')+'>Complete</option></select>'
          : '<span class="pill">'+esc(label)+'</span>';
        return '<tr><td>#'+esc(r.order_id.slice(0,8).toUpperCase())+'<br><small>'+esc(r.source||'Website')+'</small></td><td>'+esc(r.customer_name||'Customer')+'<br><small>'+esc(r.customer_phone||'')+'</small></td><td>'+esc(String(r.fulfillment_method||'pickup').replace('_',' '))+'</td><td>'+esc(r.order_status)+'</td><td>'+esc(r.station_name)+'</td><td><span class="pill">'+esc(label)+'</span></td><td>'+action+'</td></tr>';
      }).join('')+'</table>'
    : '<div class="state">No active '+esc(station.toLowerCase())+' station orders.</div>';
  document.querySelectorAll('[data-station-status]').forEach(x=>x.onchange=async()=>{
    try{
      await api('/rest/v1/rpc/set_order_station_status',{method:'POST',body:JSON.stringify({p_order_id:x.dataset.stationStatus,p_station_id:x.dataset.stationId,p_status:x.value})});
      await loadStationOrders();
    }catch(e){msg(e);await loadStationOrders();}
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
async function loadOrders(){
  if(profile?.role==='reception_manager'){await loadReceptionOrders();return;}
  if(['chef','barista'].includes(profile?.role)){await loadStationOrders();return;}
  const filter=$('#orderStatusFilter').value;
  let q='/rest/v1/orders?select=*,customers(name,phone)&order=created_at.desc';
  if(filter!=='all')q+='&status=eq.'+filter;
  let rows=await api(q);
  if(['chef','barista'].includes(profile?.role)){
    const oi=await api('/rest/v1/order_items?select=order_id,menu_items(name,station_id,service_stations(name))');
    const target=profile.role==='barista'?'Barista':'Kitchen';
    const visibleIds=new Set(oi.filter(x=>(x.menu_items?.service_stations?.name||'')===target).map(x=>x.order_id));
    rows=rows.filter(x=>visibleIds.has(x.id));
  }
  const ids=rows.map(x=>x.id);
  const progress=ids.length?await api('/rest/v1/order_station_progress?select=order_id,station_id,status,service_stations(name,sort_order)&order=order_id.asc,station_id.asc'):[]; 
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
        const name=s.service_stations?.name||'Station',label=s.status==='waiting'?'Waiting':s.status==='in_progress'?'In Progress':'Complete';
        const stationAction=(r.status==='confirmed' && (profile?.role==='owner'||profile?.role==='manager'||profile?.role==='general_manager'||profile?.role==='ceo'||profile?.role==='reception_manager'||(profile?.role==='chef'&&name==='Kitchen')||(profile?.role==='barista'&&name==='Barista')))?'<select data-station-status="'+r.id+'" data-station-id="'+s.station_id+'"><option value="waiting" '+(s.status==='waiting'?'selected':'')+'>Waiting</option><option value="in_progress" '+(s.status==='in_progress'?'selected':'')+'>In Progress</option><option value="complete" '+(s.status==='complete'?'selected':'')+'>Complete</option></select>':'<span class="pill">'+esc(label)+'</span>';
        return '<div style="display:flex;gap:8px;align-items:center;margin:3px 0"><span>'+esc(name)+'</span>'+stationAction+'</div>';
      }).join(''):'<span class="muted">Waiting</span>';
      const allComplete=station.length>0&&station.every(s=>s.status==='complete');
      const confirmText='Hello '+customerName+', your order has been confirmed by Kiteezi Recreational Center. Your order is now being prepared.';
      const readyText=method==='delivery'?'Hello '+customerName+', your order is completed and ready for delivery.':method==='dine_in'?'Hello '+customerName+', your order is completed and ready. Please proceed for dine-in.':'Hello '+customerName+', your order is completed and ready for pickup at Kiteezi Recreational Center.';
      const confirmBtn=hasPermission('orders.confirm')&&(r.status==='pending'||r.status==='open')?'<button class="btn" data-confirm-wa="'+r.id+'" data-wa="'+esc(phone)+'" data-watext="'+esc(confirmText)+'">Confirm</button> ':'';
      const completeBtn=(r.status==='confirmed'&&canGlobalComplete&&(!station.length||allComplete))?'<button class="btn" data-done-wa="'+r.id+'" data-wa="'+esc(phone)+'" data-watext="'+esc(readyText)+'">Complete</button> ':'';
      const paidBtn=hasPermission('orders.pay')&&(r.status!=='cancelled'&&r.payment_status!=='paid')?'<button class="btn" data-paid="'+r.id+'">Paid</button> ':'';
      const cancelBtn=hasPermission('orders.cancel')&&(r.status!=='completed'&&r.status!=='cancelled')?'<button class="btn" data-admin-cancel="'+r.id+'" data-customer="'+esc(customerName)+'" data-phone="'+esc(phone)+'">Cancel</button> ':'';
      const itemsBtn='<button class="btn" data-items="'+r.id+'">Items</button> ';
      const deleteBtn=profile?.role==='owner'?'<button class="btn danger" data-delete-order="'+r.id+'">Delete test</button>':'';
      return '<tr><td>#'+esc(r.id.slice(0,8).toUpperCase())+'<br>'+esc(r.source)+'</td><td>'+esc(customerName)+'<br>'+esc(phone)+'</td><td>'+esc(method==='delivery'?'Delivery':method==='dine_in'?'Dine in':'Pickup from Kiteezi')+'</td><td>'+esc(r.status==='pending'||r.status==='open'?'Waiting for Confirmation':r.status==='confirmed'?'In Progress':r.status==='completed'?'Complete':r.status)+'</td><td>'+stationHtml+'</td><td>'+esc(r.payment_status)+'</td><td>UGX '+money(r.total)+'</td><td class="actions">'+confirmBtn+completeBtn+paidBtn+cancelBtn+itemsBtn+deleteBtn+'</td></tr>';
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
  document.querySelectorAll('[data-items]').forEach(x=>x.onclick=()=>loadOrderItems(x.dataset.items));
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
  if(!/^[1-9][0-9]{7,14}$/.test(digits)){msg(new Error('This customer does not have a valid international WhatsApp number. The status change can still be made without WhatsApp.'));return;}
  try{
    await api('/rest/v1/rpc/admin_set_order_status',{method:'POST',body:JSON.stringify({p_order_id:id,p_status:status,p_payment_status:payment})});
    await loadOrders();
  }catch(err){msg(err);return}
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
async function loadOrderItems(id){let r=await api('/rest/v1/order_items?select=id,qty,unit_price,item_name_snapshot,notes,menu_items(name,station_id,service_stations(name))&order_id=eq.'+id);if(['barista','chef'].includes(profile?.role)){const target=profile.role==='barista'?'Barista':'Kitchen';r=r.filter(x=>(x.menu_items?.service_stations?.name||'')===target)}$('#orderItemsTable').innerHTML='<table><tr><th>Item</th><th>Station</th><th>Qty</th><th>Price</th><th>Notes</th></tr>'+r.map(x=>'<tr><td>'+esc(x.item_name_snapshot||x.menu_items?.name||'')+'</td><td><span class="pill">'+esc(x.menu_items?.service_stations?.name||'Unassigned')+'</span></td><td>'+x.qty+'</td><td>UGX '+money(x.unit_price)+'</td><td>'+esc(x.notes||'')+'</td></tr>').join('')+'</table>'}

async function loadRecipeMappings(){
  const box=$('#recipeTable'); if(!box)return;
  const toolbar='<div class="toolbar"><button class="btn" id="newRecipe">Add recipe</button><button class="btn btn-dark" id="refreshRecipes">Refresh</button></div>';
  box.innerHTML=toolbar+'<div class="state">Loading recipes…</div>';
  const wire=()=>{$('#newRecipe').onclick=()=>manageRecipe();$('#refreshRecipes').onclick=()=>loadRecipeMappings().catch(msg)};
  wire();
  try{
    const [recipes,shared]=await Promise.all([
      api('/rest/v1/menu_item_recipes?select=id,menu_item_id,inventory_item_id,quantity,recipe_unit,stock_units_per_recipe_unit,menu_items(name,serving_unit,service_stations(name)),inventory_items(name,unit)&order=created_at.asc'),
      api('/rest/v1/shared_pool_menu_rules?select=id,menu_item_id,inventory_item_id,dish_type,fraction_per_menu_unit,allocation_profile,requires_components,requires_profile,requires_components,active,notes,menu_items(name,serving_unit,service_stations(name)),inventory_items(name,unit)&active=eq.true&order=menu_item_id.asc')
    ]);
    const direct=Array.isArray(recipes)?recipes:[], pool=Array.isArray(shared)?shared:[];
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
    box.innerHTML=toolbar+'<div class="state">Recipes could not be loaded. '+esc(e.message||'Please try again.')+'</div>';
    wire();
  }
}
async function loadDailyStock(){const d=$('#stockRunDate').value||today();$('#stockRunDate').value=d;const [items,movs,counts,before]=await Promise.all([api('/rest/v1/inventory_items?select=id,name,unit&active=eq.true&order=name.asc'),api('/rest/v1/stock_movements?select=item_id,quantity,movement_type,reason,created_at&created_at=gte.'+d+'T00:00:00&created_at=lte.'+d+'T23:59:59'),api('/rest/v1/inventory_daily_counts?select=inventory_item_id,physical_quantity&count_date=eq.'+d),api('/rest/v1/stock_movements?select=item_id,quantity,movement_type&created_at=lt.'+d+'T00:00:00')]);const opening={};before.forEach(x=>opening[x.item_id]=(opening[x.item_id]||0)+(String(x.movement_type).toLowerCase()==='out'?-1:1)*Number(x.quantity||0));const day={};movs.forEach(x=>{const z=day[x.item_id]||{added:0,pos:0,waste:0,owner:0,other:0};const q=Number(x.quantity||0),r=String(x.reason||'').toLowerCase();if(String(x.movement_type).toLowerCase()!=='out')z.added+=q;else if(r.startsWith('order '))z.pos+=q;else if(r==='waste')z.waste+=q;else if(r==='owner taken home')z.owner+=q;else z.other+=q;day[x.item_id]=z});const counted=Object.fromEntries(counts.map(x=>[x.inventory_item_id,Number(x.physical_quantity)]));$('#dailyStockTable').innerHTML='<table><tr><th>Item</th><th>Opening</th><th>Added</th><th>POS Used</th><th>Waste</th><th>Owner Home</th><th>Other</th><th>Expected</th><th>Physical</th><th>Variance</th></tr>'+items.map(x=>{const z=day[x.id]||{added:0,pos:0,waste:0,owner:0,other:0},op=Number(opening[x.id]||0),expected=op+z.added-z.pos-z.waste-z.owner-z.other,p=counted[x.id];return '<tr><td>'+esc(x.name)+'<br><small>'+esc(x.unit)+'</small></td><td>'+op+'</td><td>'+z.added+'</td><td>'+z.pos+'</td><td>'+z.waste+'</td><td>'+z.owner+'</td><td>'+z.other+'</td><td>'+expected+'</td><td>'+(p==null?'—':p)+'</td><td>'+(p==null?'—':p-expected)+'</td></tr>'}).join('')+'</table>'}
async function loadPurchases(){
  if(!(hasPermission('purchase_orders.view')||hasPermission('purchase_orders.manage'))){setHTML('#purchaseOrdersTable','<div class="state">Purchase receiving is not part of this account.</div>');return;}
  const orders=await api('/rest/v1/purchase_orders?select=*&order=created_at.desc');
  setHTML('#generatedPOTable',orders.length?'<table><tr><th>PO</th><th>Supplier</th><th>Reference</th><th>Status</th><th>Received</th><th>Paid</th><th>Total</th><th>Actions</th></tr>'+
    orders.map(o=>'<tr><td>'+esc(o.po_number||o.id.slice(0,8).toUpperCase())+'</td><td>'+esc(o.supplier||'')+'</td><td>'+esc(o.reference||'')+'</td><td>'+esc(o.status||'ordered')+'</td><td>'+esc(['received','partially_received'].includes(String(o.status))?'Yes':'No')+'</td><td>'+esc(o.payment_status||'unpaid')+'</td><td>UGX '+money(o.total)+'</td><td class="actions">'+
    (o.status!=='received'&&o.status!=='cancelled'?'<button class="btn" data-receive-po="'+o.id+'">Receive</button> ':'')+
    (String(o.payment_status||'unpaid')!=='paid'&&o.status!=='cancelled'?'<button class="btn" data-paid-po="'+o.id+'">Mark paid</button> ':'')+
    (profile?.role==='owner'?'<button class="btn danger" data-delete-po="'+o.id+'">Delete test</button>':'')+
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
async function addStockAdjustment(){const inv=await api('/rest/v1/inventory_items?select=id,name,unit&active=eq.true&order=name.asc');const ownerOnly=String(profile?.role||'').toLowerCase()==='owner';const homeOption=ownerOnly?'<option>Owner Taken Home</option>':'';modal('Add stock movement','<form id="adj" class="form"><select name="item">'+inv.map(x=>'<option value="'+x.id+'">'+esc(x.name)+' ('+esc(x.unit)+')</option>').join('')+'</select><select name="type"><option value="out">Stock out</option><option value="in">Stock in</option></select><select name="reason"><option>Waste</option>'+homeOption+'<option>Other Adjustment</option></select><input name="qty" type="number" step="0.001" min="0.001" placeholder="Quantity" required><textarea name="notes" placeholder="Notes"></textarea><button class="btn btn-dark">Save movement</button></form>');$('#adj').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/rest/v1/stock_movements',{method:'POST',body:JSON.stringify({item_id:f.get('item'),quantity:Number(f.get('qty')),movement_type:f.get('type'),reason:f.get('reason')+(f.get('notes')?' — '+f.get('notes'):''),staff_id:session.user.id})});closeModal();loadInventory()}}
async function loadStockMovements(){
  const r=await api('/rest/v1/stock_movements?select=*,inventory_items(name,unit)&order=created_at.desc&limit=100');
  const owner=profile?.role==='owner';
  $('#stockMovementTable').innerHTML=r.length
    ?'<table><tr><th>Date</th><th>Item</th><th>Movement</th><th>Qty</th><th>Reason</th><th></th></tr>'+
      r.map(x=>'<tr><td>'+esc(x.created_at?.slice(0,16)||'')+'</td><td>'+esc(x.inventory_items?.name||x.item_id)+'</td><td>'+esc(x.movement_type)+'</td><td>'+esc(x.quantity)+'</td><td>'+esc(x.reason||'')+'</td><td>'+(owner?'<button class="btn danger" data-delete-movement="'+x.id+'">Delete</button>':'')+'</td></tr>').join('')+
      '</table>'
    :'<div class="state">No stock movements yet.</div>';
  if(owner) $$('[data-delete-movement]').forEach(b=>b.onclick=()=>deleteTestRecord('stock_movement',b.dataset.deleteMovement));
}
async function loadInventory(){
  const box=$('#inventoryTable'); if(!box)return;
  box.innerHTML='<div class="state">Loading inventory…</div>';
  try{
    const r=await api('/rest/v1/inventory_items?select=id,name,unit,category,reorder_level,active,station_id,inventory_scope,service_stations(name)&order=name.asc');
    const rows=Array.isArray(r)?r:[];
    let mov=[];
    try{
      const movementResponse=await api('/rest/v1/stock_movements?select=item_id,quantity,movement_type');
      mov=Array.isArray(movementResponse)?movementResponse:[];
    }catch(e){
      console.warn('Inventory movement totals unavailable:',e);
    }
    const stock={};
    mov.forEach(x=>{
      if(!x||!x.item_id)return;
      stock[x.item_id]=(stock[x.item_id]||0)+(String(x.movement_type).toLowerCase()==='out'?-1:1)*Number(x.quantity||0);
    });
    const scopeForRole={chef:'kitchen',barista:'bar',grounds_cleaning:'cleaning',head_swimming_coach:'swimming'}[profile?.role];
    const rows0=scopeForRole?rows.filter(x=>x?.inventory_scope===scopeForRole):rows;
    const low=rows0.filter(x=>Number(stock[x.id]||0)<=Number(x.reorder_level||0));
    box.innerHTML=(low.length?'<div class="low-stock-banner"><strong>Low stock: '+low.length+' item(s)</strong><span>'+low.map(x=>esc(x.name)).join(', ')+'</span></div>':'')+(rows0.length?'<table><thead><tr><th>Item</th><th>Category</th><th>Unit</th><th>Station</th><th>Reorder</th><th>Active</th><th></th></tr></thead><tbody>'+
      rows0.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.category||'')+'</td><td>'+esc(x.unit||'')+'</td><td><span class="pill">'+esc(x.service_stations?.name||'Unassigned')+'</span></td><td>'+esc(x.reorder_level??0)+'</td><td>'+esc(x.active?'Yes':'No')+'</td><td><button class="btn" data-edit-inv="'+x.id+'">Edit</button></td></tr>').join('')+
      '</tbody></table>':'<div class="state">No inventory items found.</div>');
    $('[data-edit-inv]').forEach(x=>x.onclick=()=>editInventory(x.dataset.editInv));
  }catch(e){
    console.error('Inventory load failed:',e);
    box.innerHTML='<div class="state">Inventory could not be loaded. '+esc(e.message||'Please try again.')+'</div>';
  }
}
async function editInventory(id=null){
  const [stations]=await Promise.all([api('/rest/v1/service_stations?select=id,name&active=eq.true&order=sort_order.asc'),loadUnitOptions()]);
  const roleScope={chef:'kitchen',barista:'bar',grounds_cleaning:'cleaning',head_swimming_coach:'swimming'}[profile?.role]||'operational';
  const restricted=['chef','barista','grounds_cleaning','head_swimming_coach'].includes(profile?.role);
  const x=id?(await api('/rest/v1/inventory_items?id=eq.'+id))[0]:{name:'',unit:'',category:'',reorder_level:0,active:true,station_id:null,inventory_scope:roleScope};
  const allowedScopes=['owner','ceo','general_manager','manager'].includes(profile?.role)?['operational','kitchen','bar','cleaning','swimming','facility']:[roleScope];
  const stationOptions=stations.filter(st=>profile?.role==='chef'?st.name==='Kitchen':profile?.role==='barista'?st.name==='Barista':true);
  modal(id?'Inventory item':'Add inventory item','<form id="inv" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Ingredient / stock item name" required><select name="unit" required>'+unitOptionsHtml(x.unit)+'</select><select name="station"><option value="">No production station</option>'+stationOptions.map(q=>'<option value="'+q.id+'" '+(x.station_id===q.id?'selected':'')+'>'+esc(q.name)+'</option>').join('')+'</select><select name="scope" '+(restricted?'disabled':'')+'>'+allowedScopes.map(sc=>'<option value="'+sc+'" '+((x.inventory_scope||roleScope)===sc?'selected':'')+'>'+esc(sc)+'</option>').join('')+'</select><input name="category" value="'+esc(x.category||'')+'" placeholder="Category"><input name="reorder" type="number" step="0.001" value="'+(x.reorder_level||0)+'" placeholder="Reorder level"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');
  $('#inv').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),scope=restricted?roleScope:String(f.get('scope')||roleScope),body={name:f.get('name'),unit:f.get('unit'),station_id:f.get('station')||null,inventory_scope:scope,category:f.get('category')||null,reorder_level:Number(f.get('reorder')||0),active:f.get('active')==='on'};try{await api(id?'/rest/v1/inventory_items?id=eq.'+id:'/rest/v1/inventory_items',{method:id?'PATCH':'POST',body:JSON.stringify(body)});closeModal();loadInventory()}catch(err){msg(err)}}
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
    const bindRemove=()=>$('.recipe-remove',$('#recipe')).forEach(btn=>btn.onclick=()=>{const rows=$('.recipe-row',$('#recipe'));if(rows.length===1){alert('A recipe needs at least one ingredient.');return}btn.closest('.recipe-row')?.remove()});
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
      }catch(err){errorEl.textContent=err.message||'The recipe could not be saved.';errorEl.style.display='block'}
    };
  }catch(e){msg(e)}
}
async function editRecipe(id){return manageRecipe(id)}
async function loadMenu(){
  const box=$('#menuTable'); if(!box)return;
  box.innerHTML='<div class="state">Loading menu…</div>';
  try{
    let r;
    if(profile?.role==='website_manager'){
      const [safe,cats]=await Promise.all([
        api('/rest/v1/rpc/get_public_menu_admin',{method:'POST'}),
        api('/rest/v1/menu_categories?select=id,name,sort_order&active=eq.true&order=sort_order.asc,name.asc')
      ]);
      const catMap=Object.fromEntries(cats.map(c=>[c.id,c]));
      r=safe.map(x=>({...x,menu_categories:catMap[x.category_id]||null,service_stations:null}));
    }else{
      r=await api('/rest/v1/menu_items?select=*,menu_categories(id,name,sort_order),service_stations(name)&order=name.asc');
    }
    if(profile?.role==='barista')r=r.filter(x=>x.service_stations?.name==='Barista');
    if(profile?.role==='chef')r=r.filter(x=>x.service_stations?.name==='Kitchen');
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
        rows.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.menu_categories?.name||'')+'</td><td><span class="pill">'+esc(x.service_stations?.name||'Unassigned')+'</span></td><td>'+esc(x.serving_unit||'portion')+'</td><td>'+((x.price_on_request)?'Ask':'UGX '+money(x.price))+'</td><td>'+esc(x.in_stock?'Yes':'No')+'</td><td><button class="btn" data-menu="'+x.id+'">Edit</button></td></tr>').join('')+
        '</tbody></table>':'<div class="state">No menu items match your search.</div>';
      $$('[data-menu]').forEach(x=>x.onclick=()=>editMenu(x.dataset.menu));
    };
    if(search)search.oninput=render;
    if(catSelect)catSelect.onchange=render;
    render();
  }catch(e){box.innerHTML='<div class="state">Menu could not be loaded. '+esc(e.message||'Please try again.')+'</div>'}
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
  if(profile?.role==='chef')cats.splice(0,cats.length,...cats.filter(q=>!/drink|beverage/i.test(q.name)));
  if(isWebsite){
    modal('Edit public menu content','<form id="mi" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Public menu name" required><select name="category"><option value="">No category</option>'+cats.map(q=>'<option value="'+q.id+'" '+(x.category_id===q.id?'selected':'')+'>'+esc(q.name)+'</option>').join('')+'</select><textarea name="description" placeholder="Public description">'+esc(x.description||'')+'</textarea><label>Image<input id="menuImageFile" name="imageFile" type="file" accept="image/*"></label><input name="img" value="'+esc(x.img_url||'')+'" placeholder="Image URL"><input name="alt" value="'+esc(x.alt_text||'')+'" placeholder="Image alt text"><button class="btn btn-dark">Save public content</button></form>');
    $('#mi').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);let imageUrl=String(f.get('img')||'').trim();const file=f.get('imageFile');if(file instanceof File&&file.size)imageUrl=await uploadAdminImage(file,'menu');try{await api('/rest/v1/menu_items?id=eq.'+id,{method:'PATCH',body:JSON.stringify({name:f.get('name'),category_id:f.get('category')||null,description:f.get('description')||null,img_url:imageUrl||null,alt_text:f.get('alt')||null})});closeModal();loadMenu()}catch(err){msg(err)}};
    return;
  }
  const [stations]=await Promise.all([api('/rest/v1/service_stations?select=id,name&active=eq.true&order=sort_order.asc'),loadUnitOptions()]);
  modal(id?'Menu item':'Add menu item','<form id="mi" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Name" required><select name="category"><option value="">No category</option>'+cats.map(q=>'<option value="'+q.id+'" '+(x.category_id===q.id?'selected':'')+'>'+esc(q.name)+'</option>').join('')+'</select><select name="station" required><option value="">Choose preparation station</option>'+stations.map(q=>'<option value="'+q.id+'" '+(x.station_id===q.id?'selected':'')+'>'+esc(q.name)+'</option>').join('')+'</select><select name="serving" required>'+unitOptionsHtml(x.serving_unit||'portion')+'</select><textarea name="description" placeholder="Description">'+esc(x.description||'')+'</textarea><input name="price" type="number" step="0.01" value="'+(x.price||0)+'" placeholder="Price"><label>Image<input id="menuImageFile" name="imageFile" type="file" accept="image/*"><small class="muted">Choose an image from your phone or computer, or paste an image URL below.</small></label><input name="img" value="'+esc(x.img_url||'')+'" placeholder="Image URL"><label>Price on request <input name="por" type="checkbox" '+(x.price_on_request?'checked':'')+'></label><label>In stock <input name="stock" type="checkbox" '+(x.in_stock?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#mi').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);let imageUrl=String(f.get('img')||'').trim();const file=f.get('imageFile');if(file instanceof File&&file.size)imageUrl=await uploadAdminImage(file,'menu');const body={name:f.get('name'),category_id:f.get('category')||null,station_id:f.get('station')||null,serving_unit:String(f.get('serving')||'portion').trim()||'portion',description:f.get('description')||null,price:Number(f.get('price')||0),img_url:imageUrl||null,price_on_request:f.get('por')==='on',in_stock:f.get('stock')==='on'};await api(id?'/rest/v1/menu_items?id=eq.'+id:'/rest/v1/menu_items',{method:id?'PATCH':'POST',body:JSON.stringify(body)});closeModal();loadMenu()}
}
async function loadServices(){let [s,sp]=await Promise.all([api('/rest/v1/services?select=*&order=name.asc'),api('/rest/v1/sports?select=*&order=name.asc')]);if(['head_swimming_coach','swimming_coach'].includes(profile?.role))s=s.filter(x=>/swim/i.test(x.name+' '+(x.description||'')));$('#servicesTable').innerHTML='<table><tr><th>Name</th><th>Price</th><th>Pricing</th><th>Active</th><th></th></tr>'+s.map(x=>'<tr><td>'+esc(x.name)+'</td><td>UGX '+money(x.price)+'</td><td>'+esc(x.pricing_mode||'fixed')+'</td><td>'+x.active+'</td><td><button class="btn" data-svc="'+x.id+'">Edit</button></td></tr>').join('')+'</table>';$('#sportsTable').innerHTML='<table><tr><th>Sport</th><th>Description</th><th>Active</th><th></th></tr>'+sp.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.description||'')+'</td><td>'+x.active+'</td><td><button class="btn" data-sport="'+x.id+'">Edit</button></td></tr>').join('')+'</table>';document.querySelectorAll('[data-svc]').forEach(x=>x.onclick=()=>editService(x.dataset.svc));document.querySelectorAll('[data-sport]').forEach(x=>x.onclick=()=>editSport(x.dataset.sport))}
async function editService(id=null){const x=id?(await api('/rest/v1/services?id=eq.'+id))[0]:{name:'',description:'',price:0,team_threshold:null,small_group_price:null,full_team_price:null,active:true,pricing_mode:'fixed'};modal(id?'Service':'Add service','<form id="svc" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Service name" required><textarea name="description" placeholder="Description">'+esc(x.description||'')+'</textarea><input name="price" type="number" value="'+(x.price||0)+'" placeholder="Base price"><input name="duration" type="number" value="'+(x.duration_minutes||'')+'" placeholder="Duration minutes"><select name="pricing"><option value="fixed" '+(x.pricing_mode==='fixed'?'selected':'')+'>Fixed</option><option value="per_person" '+(x.pricing_mode==='per_person'?'selected':'')+'>Per person</option><option value="team" '+(x.pricing_mode==='team'?'selected':'')+'>Team</option></select><input name="threshold" type="number" value="'+(x.team_threshold||'')+'" placeholder="Team threshold"><input name="small" type="number" value="'+(x.small_group_price||'')+'" placeholder="Small group price"><input name="full" type="number" value="'+(x.full_team_price||'')+'" placeholder="Full team price"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#svc').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={name:f.get('name'),description:f.get('description')||null,price:Number(f.get('price')||0),duration_minutes:Number(f.get('duration')||0)||null,pricing_mode:f.get('pricing'),team_threshold:Number(f.get('threshold')||0)||null,small_group_price:Number(f.get('small')||0)||null,full_team_price:Number(f.get('full')||0)||null,active:f.get('active')==='on'};await api(id?'/rest/v1/services?id=eq.'+id:'/rest/v1/services',{method:id?'PATCH':'POST',body:JSON.stringify(body)});closeModal();loadServices()}}
async function editSport(id=null){const x=id?(await api('/rest/v1/sports?id=eq.'+id))[0]:{name:'',description:'',active:true};modal(id?'Sport':'Add sport','<form id="sport" class="form"><input name="name" value="'+esc(x.name)+'" placeholder="Sport name" required><textarea name="description" placeholder="Description">'+esc(x.description||'')+'</textarea><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#sport').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),body={name:f.get('name'),description:f.get('description')||null,active:f.get('active')==='on'};await api(id?'/rest/v1/sports?id=eq.'+id:'/rest/v1/sports',{method:id?'PATCH':'POST',body:JSON.stringify(body)});closeModal();loadServices()}}
async function storageUpload(bucket,path,file){const r=await fetch(URL+'/storage/v1/object/'+encodeURIComponent(bucket)+'/'+path,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':file.type,'x-upsert':'false'},body:file});if(!r.ok)throw Error(await r.text()||'Storage upload failed.');}
async function loadGallery(){const rows=await api('/rest/v1/gallery_items?select=*&order=status.asc,created_at.desc');const canModerate=hasPermission('gallery.moderate')||hasPermission('gallery.manage');const canUpload=hasPermission('gallery.upload')||hasPermission('gallery.manage');$('#galleryTable').innerHTML=rows.length?'<table><tr><th>Submitted</th><th>Source</th><th>Type</th><th>Category</th><th>Submitter</th><th>Status</th><th>Actions</th></tr>'+rows.map(x=>{const actions=[];if(canModerate&&x.status==='pending')actions.push('<button class="btn" data-ga="approve" data-id="'+x.id+'">Approve</button>','<button class="btn danger" data-ga="reject" data-id="'+x.id+'">Reject</button>');if(canModerate)actions.push('<button class="btn" data-ga="preview" data-id="'+x.id+'">Preview</button>');if(hasPermission('gallery.manage'))actions.push('<button class="btn danger" data-ga="delete" data-id="'+x.id+'">Delete</button>');return '<tr><td>'+esc(new Date(x.created_at).toLocaleString())+'</td><td>'+esc(x.source)+'</td><td>'+esc(x.media_type)+'</td><td>'+esc(x.category)+'</td><td>'+esc(x.submitter_name||'Staff')+'</td><td>'+esc(x.status)+'</td><td>'+actions.join(' ')+'</td></tr>'}).join('')+'</table>':'<div class="state">No gallery submissions.</div>';$('[data-ga]').forEach(b=>b.onclick=()=>galleryAction(b.dataset.ga,b.dataset.id));const add=$('#newGalleryMedia');if(add)add.hidden=!canUpload;}
async function galleryAction(action,id){const x=(await api('/rest/v1/gallery_items?id=eq.'+encodeURIComponent(id)))[0];if(!x)return;if(action==='preview'){const r=await fetch(URL+'/storage/v1/object/'+encodeURIComponent(x.storage_bucket)+'/'+x.storage_path,{headers:{apikey:KEY,Authorization:'Bearer '+session.access_token}});if(!r.ok)return msg(Error('Preview could not be loaded.'));const blob=await r.blob(),u=URL.createObjectURL(blob);modal('Gallery preview',x.media_type==='video'?'<video controls autoplay style="max-width:100%;max-height:70vh" src="'+u+'"></video>':'<img style="max-width:100%;max-height:70vh;object-fit:contain" src="'+u+'" alt="">');return}if(action==='delete'){if(!confirm('Delete this gallery item?'))return;await api('/rest/v1/gallery_items?id=eq.'+id,{method:'DELETE'});await fetch(URL+'/storage/v1/object/'+encodeURIComponent(x.storage_bucket)+'/'+x.storage_path,{method:'DELETE',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token}}).catch(()=>{});return loadGallery()}if(action==='reject'){const reason=prompt('Reason for rejection (optional):')||null;await api('/rest/v1/gallery_items?id=eq.'+id,{method:'PATCH',body:JSON.stringify({status:'rejected',rejection_reason:reason,updated_at:new Date().toISOString()})});return loadGallery()}if(action==='approve'){const orgPath='gallery/'+id+'/'+x.storage_path.split('/').pop();const rr=await fetch(URL+'/storage/v1/object/'+encodeURIComponent(x.storage_bucket)+'/'+x.storage_path,{headers:{apikey:KEY,Authorization:'Bearer '+session.access_token}});if(!rr.ok)throw Error('Private media could not be read.');const blob=await rr.blob();const put=await fetch(URL+'/storage/v1/object/gallery-public/'+orgPath,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':blob.type,'x-upsert':'false'},body:blob});if(!put.ok)throw Error(await put.text()||'Could not publish media.');await api('/rest/v1/gallery_items?id=eq.'+id,{method:'PATCH',body:JSON.stringify({storage_bucket:'gallery-public',storage_path:orgPath,status:'approved',approved_by:session.user.id,approved_at:new Date().toISOString(),updated_at:new Date().toISOString()})});await fetch(URL+'/storage/v1/object/gallery-private/'+x.storage_path,{method:'DELETE',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token}}).catch(()=>{});return loadGallery()}}
async function addGalleryMedia(){const orgRows=await api('/rest/v1/organizations?select=id&status=eq.active&order=created_at.asc&limit=1');const org=orgRows?.[0]?.id;if(!org)return msg(Error('Organization configuration is missing.'));modal('Upload gallery media','<form id="galleryAdminForm" class="form"><label>Title<input name="title" maxlength="160"></label><label>Caption<textarea name="caption" maxlength="500"></textarea></label><label>Category<select name="category"><option>General</option><option>Events</option><option>Food & Drinks</option><option>Sports</option><option>Swimming</option><option>Recreation</option><option>Facility</option></select></label><label>Image or video<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime" required><small class="muted">Maximum 50 MB.</small></label><button class="btn btn-dark">Upload</button></form>');$('#galleryAdminForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),file=f.get('file');if(!file||file.size>52428800)return alert('Choose a file no larger than 50 MB.');const imageTypes=['image/jpeg','image/png','image/webp','image/gif','image/avif'],videoTypes=['video/mp4','video/webm','video/quicktime'];if(![...imageTypes,...videoTypes].includes(file.type))return alert('Unsupported media type.');const type=imageTypes.includes(file.type)?'image':'video',path='staff/'+crypto.randomUUID()+'.'+(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'');try{const publicPath='staff/'+crypto.randomUUID()+'.'+(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'');await storageUpload('gallery-public',publicPath,file);await api('/rest/v1/gallery_items',{method:'POST',body:JSON.stringify({organization_id:org,title:f.get('title')||null,caption:f.get('caption')||null,category:f.get('category')||'General',media_type:type,storage_bucket:'gallery-public',storage_path:publicPath,source:'staff',consent_given:true,status:'approved',approved_by:session.user.id,approved_at:new Date().toISOString()})});closeModal();await loadGallery()}catch(err){msg(err)}}}
async function loadContent(){const [p,m,a]=await Promise.all([api('/rest/v1/cms_pages?select=*&order=slug.asc'),api('/rest/v1/media?select=*&order=page_slug.asc,sort_order.asc'),api('/rest/v1/announcements?select=*&order=starts_at.desc')]);$('#pagesTable').innerHTML='<table><tr><th>Slug</th><th>Title</th><th>Published</th><th></th></tr>'+p.map(x=>'<tr><td>'+esc(x.slug)+'</td><td>'+esc(x.title||'')+'</td><td>'+x.published+'</td><td><button class="btn" data-page="'+x.id+'">Edit</button></td></tr>').join('')+'</table>';$('#mediaTable').innerHTML='<table><tr><th>Page</th><th>Title</th><th>URL</th><th>Active</th><th></th></tr>'+m.map(x=>'<tr><td>'+esc(x.page_slug||'')+'</td><td>'+esc(x.title||'')+'</td><td>'+esc(x.url)+'</td><td>'+x.active+'</td><td><button class="btn" data-media="'+x.id+'">Edit</button></td></tr>').join('')+'</table>';$('#announcementsTable').innerHTML='<table><tr><th>Title</th><th>Published</th><th>Body</th><th></th></tr>'+a.map(x=>'<tr><td>'+esc(x.title)+'</td><td>'+x.published+'</td><td>'+esc(x.body||'')+'</td><td><button class="btn" data-ann="'+x.id+'">Edit</button></td></tr>').join('')+'</table>';document.querySelectorAll('[data-page]').forEach(x=>x.onclick=()=>editPage(x.dataset.page));document.querySelectorAll('[data-media]').forEach(x=>x.onclick=()=>editMedia(x.dataset.media));document.querySelectorAll('[data-ann]').forEach(x=>x.onclick=()=>editAnnouncement(x.dataset.ann))}
function table(h,rows,fn){return '<table><tr>'+h.map(x=>'<th>'+x+'</th>').join('')+'</tr>'+rows.map(x=>'<tr>'+fn(x).map(v=>'<td>'+((typeof v==='string'&&v.trim().startsWith('<button'))?v:esc(v))+'</td>').join('')+'</tr>').join('')+'</table>'}
async function editPage(id){const x=(await api('/rest/v1/cms_pages?id=eq.'+id))[0];modal('CMS page','<form id="ed" class="form"><input name="title" value="'+esc(x.title||'')+'"><textarea name="content">'+esc(JSON.stringify(x.content||{},null,2))+'</textarea><label>Published <input name="published" type="checkbox" '+(x.published?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#ed').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);let content={};try{content=JSON.parse(f.get('content')||'{}')}catch{alert('Content must be valid JSON');return}await api('/rest/v1/cms_pages?id=eq.'+id,{method:'PATCH',body:JSON.stringify({title:f.get('title'),content,published:f.get('published')==='on',updated_at:new Date().toISOString()})});closeModal();loadContent()}}
async function editMedia(id){const x=(await api('/rest/v1/media?id=eq.'+id))[0];modal('Media','<form id="ed" class="form"><input name="title" value="'+esc(x.title||'')+'"><input name="url" value="'+esc(x.url)+'" required><input name="alt" value="'+esc(x.alt_text||'')+'"><input name="page" value="'+esc(x.page_slug||'')+'"><input name="sort" type="number" value="'+x.sort_order+'"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#ed').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/rest/v1/media?id=eq.'+id,{method:'PATCH',body:JSON.stringify({title:f.get('title'),url:f.get('url'),alt_text:f.get('alt'),page_slug:f.get('page'),sort_order:Number(f.get('sort')||0),active:f.get('active')==='on'})});closeModal();loadContent()}}
async function editAnnouncement(id){const x=(await api('/rest/v1/announcements?id=eq.'+id))[0];modal('Announcement','<form id="ed" class="form"><input name="title" value="'+esc(x.title)+'" required><textarea name="body">'+esc(x.body||'')+'</textarea><label>Published <input name="published" type="checkbox" '+(x.published?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#ed').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/rest/v1/announcements?id=eq.'+id,{method:'PATCH',body:JSON.stringify({title:f.get('title'),body:f.get('body'),published:f.get('published')==='on'})});closeModal();loadContent()}}
async function addMedia(){modal('Add media','<form id="mediaForm" class="form"><input name="title" placeholder="Title"><label>Upload from device<input name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime"><small class="muted">Maximum 50 MB.</small></label><input name="url" placeholder="Or paste an existing public URL"><input name="alt" placeholder="Alt text"><input name="page" placeholder="Page slug"><input name="area" placeholder="Area (e.g. gallery)" value="gallery" required><select name="type"><option value="image">Image</option><option value="video">Video</option></select><input name="sort" type="number" value="0"><label>Gallery item <input name="gallery" type="checkbox" checked></label><label>Active <input name="active" type="checkbox" checked></label><button class="btn btn-dark">Save</button></form>');$('#mediaForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),file=f.get('file');let url=String(f.get('url')||'').trim();try{if(file&&file.size){if(file.size>52428800)throw Error('File exceeds the 50 MB limit.');const path='site/'+crypto.randomUUID()+'.'+(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'');await storageUpload('site-media',path,file);url=URL+'/storage/v1/object/public/site-media/'+path.split('/').map(encodeURIComponent).join('/')}if(!url)throw Error('Choose a local file or provide a public URL.');await api('/rest/v1/media',{method:'POST',body:JSON.stringify({title:f.get('title')||null,url,alt_text:f.get('alt')||null,page_slug:f.get('page')||null,area:f.get('area'),type:f.get('type')||null,sort_order:Number(f.get('sort')||0),is_gallery:f.get('gallery')==='on',active:f.get('active')==='on'})});closeModal();loadContent()}catch(err){msg(err)}}}
async function addAnnouncement(){modal('Add announcement','<form id="annForm" class="form"><input name="title" placeholder="Title" required><textarea name="body" placeholder="Message"></textarea><input name="starts" type="datetime-local"><input name="ends" type="datetime-local"><label>Published <input name="published" type="checkbox"></label><button class="btn btn-dark">Save</button></form>');$('#annForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/rest/v1/announcements',{method:'POST',body:JSON.stringify({title:f.get('title'),body:f.get('body')||null,starts_at:f.get('starts')?new Date(f.get('starts')).toISOString():null,ends_at:f.get('ends')?new Date(f.get('ends')).toISOString():null,published:f.get('published')==='on'})});closeModal();loadContent()}}
async function loadReviews(){const r=await api('/rest/v1/reviews?select=*&order=created_at.desc');$('#reviewsTable').innerHTML=table(['Name','Rating','Message','Approved',''],r,x=>[x.customer_name,x.rating,x.message,x.approved,'<button class="btn" data-rm="'+x.id+'">Remove</button>']);document.querySelectorAll('[data-rm]').forEach(x=>x.onclick=async()=>{if(confirm('Remove this review?')){await api('/rest/v1/reviews?id=eq.'+x.dataset.rm,{method:'DELETE'});loadReviews()}})}
async function loadSocial(){const r=await api('/rest/v1/social_links?select=*&order=sort_order.asc');$('#socialTable').innerHTML=table(['Platform','Label','URL','Active',''],r,x=>[x.platform,x.label,x.url,x.active,'<button class="btn" data-sl="'+x.id+'">Edit</button>']);document.querySelectorAll('[data-sl]').forEach(x=>x.onclick=()=>editSocial(x.dataset.sl))}
async function editSocial(id){const x=id?(await api('/rest/v1/social_links?id=eq.'+id))[0]:{platform:'',label:'',url:'',sort_order:0,active:true};if(id&&!x)throw Error('The social link could not be found.');modal('Social link','<form id="sl" class="form"><input name="platform" value="'+esc(x.platform)+'" placeholder="Platform" required><input name="label" value="'+esc(x.label)+'" placeholder="Label"><input name="url" type="url" value="'+esc(x.url)+'" placeholder="https://..." required><input name="sort" type="number" value="'+Number(x.sort_order||0)+'"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><div id="slStatus" class="notice" hidden></div><button id="slSave" class="btn btn-dark" type="submit">Save</button></form>');$('#sl').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),button=$('#slSave'),status=$('#slStatus');const body={platform:String(f.get('platform')||'').trim(),label:String(f.get('label')||'').trim(),url:String(f.get('url')||'').trim(),sort_order:Number(f.get('sort')||0),active:f.get('active')==='on'};if(!body.platform||!body.url){if(status){status.hidden=false;status.textContent='Platform and URL are required.';status.className='notice danger'}return}if(button){button.disabled=true;button.textContent='Saving…'}if(status){status.hidden=true}try{await api(id?'/rest/v1/social_links?id=eq.'+encodeURIComponent(id):'/rest/v1/social_links',{method:id?'PATCH':'POST',body:JSON.stringify(body)});await loadSocial();closeModal();showAdminToast('Saved','Social link saved successfully.')}catch(err){console.error('Social link save failed:',err);if(status){status.hidden=false;status.textContent=err.message||'The social link could not be saved.';status.className='notice danger'}if(button){button.disabled=false;button.textContent='Save'}}}}
async function loadTeamPositions(){const rows=await api('/rest/v1/team_positions?select=id,department,position,person_name,sort_order,active&order=sort_order.asc');$('#teamPositionsTable').innerHTML='<table><tr><th>Department</th><th>Position</th><th>Person</th><th>Active</th><th></th></tr>'+rows.map(x=>'<tr><td>'+esc(x.department)+'</td><td>'+esc(x.position)+'</td><td>'+esc(x.person_name||'')+'</td><td>'+x.active+'</td><td><button class="btn" data-team-edit="'+x.id+'">Edit</button> <button class="btn" data-team-delete="'+x.id+'">Remove</button></td></tr>').join('')+'</table>';document.querySelectorAll('[data-team-edit]').forEach(x=>x.onclick=()=>editTeamPosition(x.dataset.teamEdit));document.querySelectorAll('[data-team-delete]').forEach(x=>x.onclick=()=>deleteTeamPosition(x.dataset.teamDelete))}
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
  const [roles,positions]=await Promise.all([api('/rest/v1/roles?select=id,name&order=name.asc'),loadStaffPositions()]);
  const options=roles.map(r=>'<option value="'+esc(r.name)+'">'+esc(r.name)+'</option>').join('');
  modal('Add staff / owner','<form id="newStaffForm" class="form"><input name="name" placeholder="Full name" required><input name="email" type="email" placeholder="Email address" required><input name="password" type="password" minlength="8" placeholder="Password (8+ characters)" required><input name="phone" placeholder="Phone"><label>Login / Access Role<select name="role" required><option value="">Choose access role</option>'+options+'</select></label><label>Public Website Role / Position<select name="position_id" id="newStaffPosition">'+staffPositionOptions(positions)+'</select></label><input name="avatar_url" type="url" placeholder="Profile image URL (optional)"><textarea name="background_info" placeholder="Background information about the person"></textarea><p class="muted">Login / Access Role controls permissions. Public Website Role / Position comes directly from the Public Departments & Positions list and controls this person’s public website role/position.</p><button class="btn btn-dark">Create account</button></form>');
  $('#newStaffForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const body={name:String(f.get('name')||'').trim(),email:String(f.get('email')||'').trim(),password:String(f.get('password')||''),phone:String(f.get('phone')||'').trim(),role:String(f.get('role')||'').trim(),position_id:String(f.get('position_id')||'').trim()||null,avatar_url:String(f.get('avatar_url')||'').trim(),background_info:String(f.get('background_info')||'').trim()};try{await api('/functions/v1/create-staff',{method:'POST',body:JSON.stringify(body)});alert('Account created.');closeModal();loadStaff()}catch(err){alert(err.message||'Could not create account.')}}}
async function loadStaff(){await loadTeamPositions();const [r,roles]=await Promise.all([api('/rest/v1/profiles?select=id,full_name,phone,role,position_id,active,created_at,avatar_url,background_info,team_positions!profiles_position_id_fkey(position,department)&order=full_name.asc'),api('/rest/v1/roles?select=id,name&order=name.asc')]);$('#staffTable').innerHTML='<table><tr><th>Name</th><th>Phone</th><th>Login / Access Role</th><th>Public Website Role / Position</th><th>Active</th><th></th></tr>'+r.map(x=>'<tr><td>'+esc(x.full_name)+'</td><td>'+esc(x.phone||'')+'</td><td>'+esc(x.role)+'</td><td>'+esc(x.team_positions?.position||'')+(x.team_positions?.department?' — '+esc(x.team_positions.department):'')+'</td><td>'+x.active+'</td><td><button class="btn" data-staff="'+x.id+'">Edit</button></td></tr>').join('')+'</table>';document.querySelectorAll('[data-staff]').forEach(x=>x.onclick=()=>editStaff(x.dataset.staff,roles))}
async function editStaff(id,roles){const x=(await api('/rest/v1/profiles?id=eq.'+id))[0];const positions=await loadStaffPositions();modal('Staff profile','<form id="staffForm" class="form"><input name="name" value="'+esc(x.full_name||'')+'"><input name="phone" value="'+esc(x.phone||'')+'"><input name="avatar_url" type="url" value="'+esc(x.avatar_url||'')+'" placeholder="Profile image URL"><textarea name="background_info" placeholder="Background information">'+esc(x.background_info||'')+'</textarea><label>Login / Access Role<select name="role"><option value="">Choose access role</option>'+roles.map(r=>'<option '+(r.name===x.role?'selected':'')+' value="'+esc(r.name)+'">'+esc(r.name)+'</option>').join('')+'</select></label><label>Public Website Role / Position<select name="position_id" id="staffPosition">'+staffPositionOptions(positions,x.position_id)+'</select></label><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form>');$('#staffForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);await api('/rest/v1/profiles?id=eq.'+id,{method:'PATCH',body:JSON.stringify({full_name:f.get('name'),phone:f.get('phone'),avatar_url:f.get('avatar_url')||null,background_info:f.get('background_info')||null,role:f.get('role'),position_id:String(f.get('position_id')||'').trim()||null,active:f.get('active')==='on'})});closeModal();loadStaff()}}
let lastReport=null;
async function loadReport(){
  const from=$('#reportFrom').value||today(),to=$('#reportTo').value||today();
  if(from>to){alert('The report start date cannot be after the end date.');return}
  const service=$('#reportService')?.value||'All Services';
  const [b,o,e,p,m,d]=await Promise.all([
    api('/rest/v1/bookings?select=id,total,booking_date,status,payment_status&booking_date=gte.'+from+'&booking_date=lte.'+to+'&status=neq.cancelled'),
    api('/rest/v1/orders?select=id,total,created_at,status,payment_status&created_at=gte.'+from+'T00:00:00&created_at=lte.'+to+'T23:59:59&status=neq.cancelled'),
    api('/rest/v1/events?select=id,total,event_date,status&event_date=gte.'+from+'&event_date=lte.'+to+'&status=neq.cancelled'),
    api('/rest/v1/purchase_orders?select=id,supplier,reference,total,created_at,status&created_at=gte.'+from+'T00:00:00&created_at=lte.'+to+'T23:59:59&status=neq.cancelled'),
    api('/rest/v1/stock_movements?select=id,item_id,quantity,movement_type,reason,supplier,staff_id,created_at&created_at=gte.'+from+'T00:00&created_at=lte.'+to+'T23:59:59&order=created_at.desc'),
    api('/rest/v1/inventory_daily_counts?select=id,inventory_item_id,count_date,physical_quantity,counted_by,notes&count_date=gte.'+from+'&count_date=lte.'+to+'&order=count_date.desc')
  ]);
  if(service!=='All Services'){
    if(service==='Bookings'){o.length=0;e.length=0;p.length=0}
    else if(service==='Orders'){b.length=0;e.length=0;p.length=0}
    else if(service==='Events'){b.length=0;o.length=0;p.length=0}
    else if(service==='Purchases'){b.length=0;o.length=0;e.length=0}
  }
  const [inv,mAll]=await Promise.all([
    api('/rest/v1/inventory_items?select=id,name,unit,category,station_id&active=eq.true&order=name.asc'),
    api('/rest/v1/stock_movements?select=item_id,quantity,movement_type')
  ]);
  const invById=Object.fromEntries(inv.map(x=>[x.id,x]));
  const value=b.reduce((a,x)=>a+Number(x.total||0),0)+o.reduce((a,x)=>a+Number(x.total||0),0)+e.reduce((a,x)=>a+Number(x.total||0),0);
  const spend=p.reduce((a,x)=>a+Number(x.total||0),0);
  const movementQty=m.reduce((a,x)=>a+Math.abs(Number(x.quantity||0)),0);
  const paid=(x)=>String(x?.payment_status||'').toLowerCase()==='paid';
  const cashIn=b.filter(paid).reduce((a,x)=>a+Number(x.total||0),0)+o.filter(paid).reduce((a,x)=>a+Number(x.total||0),0)+e.reduce((a,x)=>a+Number(x.total||0),0);
  const outstanding=b.filter(x=>!paid(x)).reduce((a,x)=>a+Number(x.total||0),0)+o.filter(x=>!paid(x)).reduce((a,x)=>a+Number(x.total||0),0);
  const net=cashIn-spend;
  setText('#reportRevenue','UGX '+money(cashIn));setText('#reportPurchases','UGX '+money(spend));
  setText('#reportNet','UGX '+money(net));setText('#reportOutstanding','UGX '+money(outstanding));
  const inOrders=o.filter(paid).reduce((a,x)=>a+Number(x.total||0),0),inBookings=b.filter(paid).reduce((a,x)=>a+Number(x.total||0),0),inEvents=e.reduce((a,x)=>a+Number(x.total||0),0);
  setText('#reportInOrders','UGX '+money(inOrders));setText('#reportInBookings','UGX '+money(inBookings));setText('#reportInEvents','UGX '+money(inEvents));
  setText('#reportOutstandingOrders','UGX '+money(o.filter(x=>!paid(x)).reduce((a,x)=>a+Number(x.total||0),0)));
  setText('#reportOutstandingBookings','UGX '+money(b.filter(x=>!paid(x)).reduce((a,x)=>a+Number(x.total||0),0)));
  const foodSpend=p.filter(x=>/food|kitchen/i.test(String(x.category||x.notes||x.supplier||''))).reduce((a,x)=>a+Number(x.total||0),0);
  const beverageSpend=p.filter(x=>/beverage|bar|drink/i.test(String(x.category||x.notes||x.supplier||''))).reduce((a,x)=>a+Number(x.total||0),0);
  const otherSpend=Math.max(0,spend-foodSpend-beverageSpend);
  setText('#reportFoodPurchases','UGX '+money(foodSpend));setText('#reportBeveragePurchases','UGX '+money(beverageSpend));setText('#reportOtherPurchases','UGX '+money(otherSpend));
  const setLegend=(id,items)=>{$('#'+id).innerHTML=items.map((x,i)=>'<div><i class="'+(['','blue','purple','orange','cyan'][i]||'')+'"></i><span>'+x[0]+'</span><b>'+x[1]+'</b></div>').join('')};
  setLegend('moneyInLegend',[['Orders','UGX '+money(inOrders)],['Bookings','UGX '+money(inBookings)],['Events','UGX '+money(inEvents)],['Other','UGX 0']]);
  setLegend('moneyOutLegend',[['Food Purchases','UGX '+money(foodSpend)],['Beverage Purchases','UGX '+money(beverageSpend)],['Other Purchases','UGX '+money(otherSpend)],['Operating Expenses','UGX 0']]);
  setText('#moneyInDonutValue',money(cashIn));setText('#moneyOutDonutValue',money(spend));
  const max=Math.max(cashIn,spend,Math.abs(net),1);document.querySelectorAll('#cashFlowChart .bar-col').forEach((el,i)=>{const v=[cashIn,spend,Math.abs(net)][i];el.querySelector('span').textContent=money(v);el.querySelector('i').style.height=Math.max(3,(v/max)*78)+'%'});
  const movementRows=m.map(x=>['Stock movement',x.id,String(x.created_at||'').slice(0,10),x.movement_type||'',(invById[x.item_id]?.name||x.item_id)+' — '+(x.reason||''),x.quantity]);
  const balances={};mAll.forEach(x=>{const q=Number(x.quantity||0);balances[x.item_id]=(balances[x.item_id]||0)+(String(x.movement_type||'').toLowerCase()==='out'?-q:q)});
  const inventoryRows=inv.map(x=>['Inventory balance',x.id,to||today(),'current',(x.name+' ('+x.unit+')'),balances[x.id]||0]);
  const purchaseRows=p.map(x=>['Purchase',x.id,String(x.created_at||'').slice(0,10),x.status||'',x.supplier||x.reference||'',x.total]);
  const stockRows=d.map(x=>['Physical count',x.id,x.count_date,'counted',(invById[x.inventory_item_id]?.name||x.inventory_item_id),x.physical_quantity]);
  const rows=[
    ...b.map(x=>['Booking',x.id,x.booking_date,x.status,x.total]),
    ...o.map(x=>['Order',x.id,String(x.created_at||'').slice(0,10),x.status,x.total]),
    ...e.map(x=>['Event',x.id,x.event_date,x.status,x.total]),
    ...purchaseRows,...movementRows,...stockRows,...inventoryRows
  ];
  lastReport={from,to,b,o,e,p,m,d,inv,value,spend,cashIn,outstanding,net,movementQty,rows};
  lastReport.views={
    treasury:rows.filter(x=>['Booking','Order','Event','Purchase'].includes(x[0])),
    sales:rows.filter(x=>['Booking','Order','Event'].includes(x[0])),
    purchases:rows.filter(x=>x[0]==='Purchase'),
    inventory:rows.filter(x=>['Stock movement','Physical count','Inventory balance'].includes(x[0]))
  };
  const detailRows=[...o.map(x=>['in','Money In','Order',String(x.created_at||'').slice(0,16),'Restaurant','',Number(x.total||0)]),...b.map(x=>['in','Money In','Booking',x.booking_date,'Sports / Booking','',Number(x.total||0)]),...e.map(x=>['in','Money In','Event',x.event_date,'Event','',Number(x.total||0)]),...p.map(x=>['out','Money Out','Purchase',String(x.created_at||'').slice(0,16),x.supplier||'Purchase','',-Number(x.total||0)])].sort((a,b)=>String(a[3]).localeCompare(String(b[3])));
  setHTML('#reportTable','<table class="treasury-table"><thead><tr><th>Date & Time</th><th>Type</th><th>Source / Expense</th><th>Service</th><th>Description</th><th>Amount (UGX)</th><th>Running Balance (UGX)</th></tr></thead><tbody>'+(()=>{let bal=0;return detailRows.map(r=>{bal+=r[6];return '<tr class="'+r[0]+'"><td>'+esc(r[3])+'</td><td class="'+(r[0]==='in'?'money-in':'money-out')+'">'+esc(r[1])+'</td><td>'+esc(r[2])+'</td><td>'+esc(r[4])+'</td><td>'+esc(r[5])+'</td><td class="'+(r[0]==='in'?'money-in':'money-out')+'">'+(r[6]>=0?'+':'')+money(r[6])+'</td><td>'+money(bal)+'</td></tr>'}).join('')})()+'</tbody></table>');
  setHTML('#salesServiceTable','<table class="mini-table"><thead><tr><th>Service</th><th>Revenue (UGX)</th><th>% of Total</th></tr></thead><tbody>'+[['Restaurant / Kitchen',inOrders],['Bookings / Sports',inBookings],['Events',inEvents]].map(x=>'<tr><td>'+x[0]+'</td><td>'+money(x[1])+'</td><td>'+((cashIn?x[1]/cashIn*100:0).toFixed(1))+'%</td></tr>').join('')+'<tr><th>Total Revenue</th><th>'+money(cashIn)+'</th><th>100%</th></tr></tbody></table>');
  setHTML('#inventorySummaryTable','<table class="mini-table"><thead><tr><th>Item / Activity</th><th>Purchases</th><th>Used / Movement</th><th>Closing</th></tr></thead><tbody>'+inv.slice(0,8).map(x=>{const q=m.filter(z=>z.item_id===x.id).reduce((a,z)=>a+Number(z.quantity||0),0);return '<tr><td>'+esc(x.name)+'</td><td>—</td><td>'+money(q)+'</td><td>—</td></tr>'}).join('')+'</tbody></table>');
  setHTML('#reconciliationSummary','<div class="recon-row"><span>Total Money In</span><strong>'+money(cashIn)+'</strong></div><div class="recon-row"><span>Total Money Out</span><strong>'+money(spend)+'</strong></div><div class="recon-row net"><span>Net Cash Movement</span><strong>'+money(net)+'</strong></div><div class="recon-row warning"><span>Inventory Value Change</span><strong>—</strong></div><div class="recon-row info"><span>Outstanding (Unpaid)</span><strong>'+money(outstanding)+'</strong></div>');
  renderReportView('treasury');
}
function renderReportView(view){
  if(!lastReport)return;
  const titles={treasury:'Treasury / Cash Flow',sales:'Sales & Revenue',purchases:'Purchases & Expenses',inventory:'Inventory & Stock Flow'};
  const reportTitle=$('#reportTableTitle'); if(reportTitle)reportTitle.textContent=titles[view]||titles.treasury;
  const rows=lastReport.views?.[view]||lastReport.rows;
  setHTML('#reportTable',table(['Type','ID','Date','Status / Type','Item / Supplier','Value / Quantity'],rows,x=>x));
  document.querySelectorAll('[data-report-view]').forEach(b=>b.classList.toggle('active',b.dataset.reportView===view));
}
async function loadSettings(){const r=await api('/rest/v1/site_settings?select=key,value&order=key.asc');const logo=r.find(x=>x.key==='logo_url');const logoInput=$('#logoUrl');if(logoInput)logoInput.value=logo?.value||'';const locationInput=$('#locationUrl');if(locationInput)locationInput.value=r.find(x=>x.key==='location_url')?.value||'';const informationEmail=$('#informationEmail');if(informationEmail)informationEmail.value=r.find(x=>x.key==='information_email')?.value||'';const bookingsEmail=$('#bookingsEmail');if(bookingsEmail)bookingsEmail.value=r.find(x=>x.key==='bookings_email')?.value||'';const preview=$('#logoPreview');if(preview){const v=logo?.value||'';preview.src=v?(v.startsWith('http')?v:'../'+v.replace(/^\/+/,'')):'';preview.hidden=!v;}$('#settingsTable').innerHTML=r.filter(x=>!['logo_url','location_url','information_email','bookings_email'].includes(x.key)).map(x=>'<label>'+esc(x.key)+'<input data-set="'+esc(x.key)+'" value="'+esc(x.value||'')+'"></label>').join('')}
async function saveSettings(){try{const logoFile=$('#logoFile')?.files?.[0];if(logoFile){if(logoFile.size>52428800)throw Error('Logo exceeds the 50 MB limit.');if(!['image/jpeg','image/png','image/webp','image/svg+xml'].includes(logoFile.type))throw Error('Unsupported logo type.');const path='branding/logo-'+crypto.randomUUID()+'.'+(logoFile.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,'');await storageUpload('site-media',path,logoFile);const logoUrl=URL+'/storage/v1/object/public/site-media/'+path.split('/').map(encodeURIComponent).join('/');await api('/rest/v1/site_settings?key=eq.logo_url',{method:'PATCH',body:JSON.stringify({value:logoUrl,updated_at:new Date().toISOString()})});}for(const x of document.querySelectorAll('[data-set]')){if(x.dataset.set==='logo_url'&&logoFile)continue;await api('/rest/v1/site_settings?key=eq.'+encodeURIComponent(x.dataset.set),{method:'PATCH',body:JSON.stringify({value:x.value,updated_at:new Date().toISOString()})})}await loadSettings();await loadAdminLogo();alert('Site settings saved.')}catch(err){msg(err)}}
function modal(title,body){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=body;$('#modal').classList.add('open')}
function printReport(){if(!lastReport){return alert('Generate a report first.')}window.print()}
function downloadReport(){
  if(!lastReport)return alert('Generate a report first.');
  const escHtml=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const rows=[['Type','ID','Date','Status / Type','Item / Supplier','Value / Quantity'],...lastReport.rows];
  const header=rows[0].map(v=>'<th>'+escHtml(v)+'</th>').join('');
  const tableRows=rows.slice(1).map(r=>'<tr>'+r.map(v=>'<td>'+escHtml(v)+'</td>').join('')+'</tr>').join('');
  const doc='<!doctype html><html><head><meta charset="utf-8"><title>Kiteezi Treasury Report</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#17221d}h1{margin-bottom:4px}p{color:#66736b}.summary{display:flex;gap:12px;flex-wrap:wrap}.box{border:1px solid #d8dfda;padding:12px;min-width:170px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{border:1px solid #d8dfda;padding:8px;text-align:left;font-size:12px}th{background:#eef3ef}</style></head><body><h1>Kiteezi Treasury & Reports</h1><p>Period: '+escHtml(lastReport.from)+' to '+escHtml(lastReport.to)+'</p><div class="summary"><div class="box"><b>Money In</b><br>UGX '+money(lastReport.cashIn||0)+'</div><div class="box"><b>Money Out</b><br>UGX '+money(lastReport.spend||0)+'</div><div class="box"><b>Net Cash</b><br>UGX '+money(lastReport.net||0)+'</div><div class="box"><b>Outstanding</b><br>UGX '+money(lastReport.outstanding||0)+'</div></div><table><thead><tr>'+header+'</tr></thead><tbody>'+tableRows+'</tbody></table></body></html>';
  const blob=new Blob([doc],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='kiteezi-treasury-report-'+lastReport.from+'-to-'+lastReport.to+'.html';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function editStations(){const rows=await loadStations();modal('Preparation stations','<p class="muted">These stations control where menu orders are sent. Unit such as bottle/glass/shot does not determine routing.</p><div id="stationRows">'+rows.map(x=>'<div class="cardx" style="margin:8px 0"><form class="station-form" data-id="'+x.id+'"><input name="name" value="'+esc(x.name)+'" required><input name="description" value="'+esc(x.description||'')+'" placeholder="Description"><label>Active <input name="active" type="checkbox" '+(x.active?'checked':'')+'></label><button class="btn btn-dark">Save</button></form></div>').join('')+'</div><button type="button" class="btn" id="addStation">Add station</button>');$$('.station-form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.currentTarget);await api('/rest/v1/service_stations?id=eq.'+e.currentTarget.dataset.id,{method:'PATCH',body:JSON.stringify({name:fd.get('name'),description:fd.get('description')||null,active:fd.get('active')==='on'})});await editStations()});$('#addStation').onclick=async()=>{await api('/rest/v1/service_stations',{method:'POST',body:JSON.stringify({name:'New Station',description:'',active:true,sort_order:rows.length+1})});await editStations()}}
function closeModal(){$('#modal').classList.remove('open');$('#modalBody').innerHTML=''}

// admin-login.js owns the login submit handler.
$('#logout').onclick=async()=>{try{await api('/auth/v1/logout',{method:'POST'})}catch{}sessionStorage.removeItem('kiteezi_admin_session');location.reload()};$('#nav').addEventListener('click',e=>{const a=e.target.closest('[data-tab]');if(a){e.preventDefault();history.replaceState(null,'','#'+a.dataset.tab);route(a.dataset.tab)}});window.addEventListener('hashchange',()=>route(location.hash.slice(1)));$('#modalClose').onclick=closeModal;$('#refreshBookings').onclick=loadBookings;$('#refreshOrders').onclick=loadOrders;$('#refreshInventory').onclick=loadInventory;$('#refreshStockRun').onclick=loadDailyStock;$('#setOpeningStock').onclick=setOpeningStock;$('#notificationBell').onclick=toggleNotifications;$('#markNotificationsRead').onclick=markNotificationsRead;$('#countStock').onclick=async()=>{const inv=await api('/rest/v1/inventory_items?select=id,name,unit&active=eq.true&order=name.asc'),d=$('#stockRunDate').value||today(),existing=await api('/rest/v1/inventory_daily_counts?select=id,inventory_item_id,physical_quantity&count_date=eq.'+d);modal('Enter physical stock count','<form id="countForm" class="form">'+inv.map(x=>{const e=existing.find(q=>q.inventory_item_id===x.id);return '<label>'+esc(x.name)+' ('+esc(x.unit)+')<input name="'+x.id+'" type="number" step="0.001" min="0" value="'+(e?.physical_quantity??'')+'"></label>'}).join('')+'<button class="btn btn-dark">Save counts</button></form>');$('#countForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);for(const x of inv){const v=f.get(x.id);if(v!==null&&v!==''){const old=existing.find(q=>q.inventory_item_id===x.id),body={inventory_item_id:x.id,count_date:d,physical_quantity:Number(v),counted_by:session.user.id};await api(old?'/rest/v1/inventory_daily_counts?id=eq.'+old.id:'/rest/v1/inventory_daily_counts',{method:old?'PATCH':'POST',body:JSON.stringify(body)})}}closeModal();loadDailyStock()}};$('#refreshPurchases').onclick=loadPurchases;$('#newStockAdjustment').onclick=addStockAdjustment;$('#refreshMenu').onclick=loadMenu;$('#refreshServices').onclick=loadServices;$('#refreshInquiries').onclick=loadInquiries;$('#refreshSwimmingTimetable').onclick=loadSwimmingTimetable;$('#refreshSwimmingSessions').onclick=loadSwimmingSessions;$('#newTask').onclick=()=>editTask();$('#refreshTasks').onclick=loadTasks;$('#newSwimmingSlot').onclick=()=>editSwimmingSlot(null);$('#refreshPages').onclick=loadContent;$('#refreshMedia').onclick=loadContent;$('#refreshAnnouncements').onclick=loadContent;$('#refreshReviews').onclick=loadReviews;$('#refreshSocial').onclick=loadSocial;$('#newStaff').onclick=addStaff;$('#refreshStaff').onclick=loadStaff;$('#newTeamPosition').onclick=()=>editTeamPosition();$('#generateReport').onclick=loadReport;$('#downloadReport').onclick=downloadReport;document.querySelectorAll('[data-report-view]').forEach(b=>b.onclick=()=>renderReportView(b.dataset.reportView));$('#printReport').onclick=printReport;$('#refreshSettings').onclick=loadSettings;$('#saveSettings').onclick=saveSettings;$('#newRequisition').onclick=()=>createRequisition();$('#refreshRequisitions').onclick=loadRequisitions;$('#refreshGeneratedPOs').onclick=loadGeneratedPOs;$('#newServiceLog').onclick=()=>newServiceLog();$('#refreshServiceTally').onclick=loadServiceTally;$('#newOrder').onclick=async()=>{const m=await api('/rest/v1/menu_items?select=id,name,price,price_on_request,in_stock&in_stock=eq.true&price_on_request=eq.false&order=name.asc');modal('New POS order','<form id="pos" class="form"><input name="customer" placeholder="Customer name"><input name="phone" placeholder="Phone"><textarea name="notes" placeholder="Notes"></textarea><div id="posItems">'+m.map(x=>'<label style="display:flex;gap:8px;align-items:center"><input type="number" min="0" value="0" data-pos="'+x.id+'" style="width:80px"><span>'+esc(x.name)+' — UGX '+money(x.price)+'</span></label>').join('')+'</div><button class="btn btn-dark">Create order</button></form>');$('#pos').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),items=[...e.currentTarget.querySelectorAll('[data-pos]')].map(x=>({id:x.dataset.pos,quantity:Number(x.value||0)})).filter(x=>x.quantity>0);if(!items.length)return alert('Select at least one item.');await api('/rest/v1/rpc/create_pos_order',{method:'POST',body:JSON.stringify({p_customer_name:f.get('customer')||null,p_phone:f.get('phone')||null,p_items:items,p_notes:f.get('notes')||null})});closeModal();loadOrders()}};$('#newSocial').onclick=()=>editSocial();$('#newInventoryItem').onclick=()=>editInventory();$('#manageStations').onclick=editStations;$('#inventorySearch').oninput=e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('#inventoryTable tbody tr').forEach(r=>r.style.display=r.textContent.toLowerCase().includes(q)?'':'none')};$('#newMenu').onclick=()=>editMenu(); $('#inventorySubnav')?.addEventListener('click',e=>{const b=e.target.closest('[data-inv-tab]');if(!b)return;document.querySelectorAll('#inventorySubnav [data-inv-tab]').forEach(x=>x.classList.toggle('active',x===b));const key=b.dataset.invTab;document.querySelectorAll('[id^="inventory-panel-"]').forEach(x=>x.style.display=x.id==='inventory-panel-'+key?'block':'none');const loaders={items:loadInventory,daily:loadDailyStock,purchases:loadPurchases,movements:loadStockMovements,recipes:loadRecipeMappings};(loaders[key]||loadInventory)().catch(msg)}); document.querySelectorAll('[id^="inventory-panel-"]').forEach(x=>x.style.display=x.id==='inventory-panel-items'?'block':'none');$('#newService').onclick=()=>editService();$('#newSport').onclick=()=>editSport();$('#newMedia').onclick=addMedia;$('#newGalleryMedia').onclick=addGalleryMedia;$('#refreshGallery').onclick=loadGallery;$('#newAnnouncement').onclick=addAnnouncement;restore();
