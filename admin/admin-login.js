'use strict';
(function(){
  if(window.__KITEEZI_ADMIN_LOGIN_BOUND__) return;
  const C=window.KITEEZI_CONFIG||{};
  const URL=String(C.SUPABASE_URL||'').replace(/\/+$/,'');
  const KEY=String(C.SUPABASE_ANON_KEY||'');
  const form=document.getElementById('loginForm');
  const statusEl=document.getElementById('loginMsg');

  function status(message,kind){
    if(!statusEl)return;
    statusEl.hidden=false;
    statusEl.textContent=message;
    statusEl.className='notice'+(kind==='error'?' danger':'');
  }
  function saveSession(data){sessionStorage.setItem('kiteezi_admin_session',JSON.stringify(data));}
  async function refreshSession(){
    const raw=sessionStorage.getItem('kiteezi_admin_session');
    if(!raw||!URL||!KEY)return null;
    let old;try{old=JSON.parse(raw)}catch{return null}
    if(!old?.refresh_token)return null;
    const r=await fetch(URL+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:old.refresh_token})
    });
    if(!r.ok)return null;
    const data=await r.json();
    if(data?.access_token&&data?.user?.id){saveSession(data);return data}
    return null;
  }
  async function signIn(e){
    e.preventDefault();
    if(form.dataset.busy==='1')return false;
    form.dataset.busy='1';
    const f=new FormData(form);
    const email=String(f.get('email')||'').trim();
    const password=String(f.get('password')||'');
    const button=form.querySelector('button[type="submit"]');
    if(!URL||!KEY){status('Admin configuration is missing. Please contact the site owner.','error');form.dataset.busy='';return false}
    status('Signing in…');if(button)button.disabled=true;
    try{
      const response=await fetch(URL+'/auth/v1/token?grant_type=password',{
        method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},
        body:JSON.stringify({email,password})
      });
      const data=await response.json().catch(()=>null);
      if(!response.ok){
        const code=String(data?.error||'').toLowerCase(), message=String(data?.msg||data?.message||data?.error_description||'').toLowerCase();
        if(code.includes('invalid')||message.includes('invalid')||message.includes('password'))throw Error('Invalid email or password.');
        if(message.includes('confirm'))throw Error('This staff email has not been confirmed.');
        throw Error(data?.msg||data?.message||data?.error_description||'Sign in failed. Please try again.');
      }
      if(!data?.access_token||!data?.user?.id)throw Error('Login succeeded but no valid session was returned.');
      const profileResponse=await fetch(URL+'/rest/v1/profiles?select=*&id=eq.'+encodeURIComponent(data.user.id)+'&limit=1',{
        headers:{apikey:KEY,Authorization:'Bearer '+data.access_token,'Content-Type':'application/json'}
      });
      const profiles=await profileResponse.json().catch(()=>null);
      if(!profileResponse.ok)throw Error(profiles?.message||profiles?.msg||'Unable to verify the Kiteezi staff profile.');
      const profile=profiles?.[0];
      if(!profile)throw Error('This account has no Kiteezi staff profile.');
      if(!profile.active)throw Error('This Kiteezi staff profile is inactive.');
      saveSession(data);
      status('Signed in. Opening admin…');
      window.location.replace(window.location.pathname);
    }catch(err){
      status(err?.message||'Sign in failed. Please try again.','error');
    }finally{
      form.dataset.busy='';if(button)button.disabled=false;
    }
    return false;
  }
  if(!form){console.error('Kiteezi admin login form was not found.');return}
  form.addEventListener('submit',signIn,{once:false});
  window.__KITEEZI_ADMIN_LOGIN_BOUND__=true;
  window.__KITEEZI_REFRESH_ADMIN_SESSION__=refreshSession;
})();