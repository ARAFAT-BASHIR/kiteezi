'use strict';
(function(){
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

  async function signIn(e){
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    const email=String(f.get('email')||'').trim();
    const password=String(f.get('password')||'');
    const button=e.currentTarget.querySelector('button[type="submit"]');

    if(!URL||!KEY){
      status('Admin configuration is missing. Please contact the site owner.','error');
      return false;
    }

    status('Signing in…');
    if(button)button.disabled=true;

    try{
      const response=await fetch(URL+'/auth/v1/token?grant_type=password',{
        method:'POST',
        headers:{apikey:KEY,'Content-Type':'application/json'},
        body:JSON.stringify({email,password})
      });
      const raw=await response.text();
      let data=null;
      try{data=raw?JSON.parse(raw):null}catch{}
      if(!response.ok){
        const code=String(data?.error||'').toLowerCase();
        const message=String(data?.msg||data?.message||data?.error_description||'').toLowerCase();
        if(code.includes('invalid')||message.includes('invalid')||message.includes('password')){
          throw Error('Invalid email or password.');
        }
        if(message.includes('confirm')){
          throw Error('This staff email has not been confirmed.');
        }
        throw Error(data?.msg||data?.message||data?.error_description||'Sign in failed. Please try again.');
      }
      if(!data?.access_token||!data?.user?.id)throw Error('Login succeeded but no valid session was returned.');

      const profileResponse=await fetch(
        URL+'/rest/v1/profiles?select=*&id=eq.'+encodeURIComponent(data.user.id)+'&limit=1',
        {headers:{apikey:KEY,Authorization:'Bearer '+data.access_token,'Content-Type':'application/json'}}
      );
      const profileRaw=await profileResponse.text();
      let profiles=null;
      try{profiles=profileRaw?JSON.parse(profileRaw):null}catch{}
      if(!profileResponse.ok)throw Error(profiles?.message||profiles?.msg||'Unable to verify the Kiteezi staff profile.');
      const profile=profiles?.[0];
      if(!profile)throw Error('This account has no Kiteezi staff profile.');
      if(!profile.active)throw Error('This Kiteezi staff profile is inactive.');

      sessionStorage.setItem('kiteezi_admin_session',JSON.stringify(data));
      status('Signed in. Opening admin…');
      window.location.href=window.location.pathname;
    }catch(err){
      status(err?.message||'Sign in failed. Please try again.','error');
    }finally{
      if(button)button.disabled=false;
    }
    return false;
  }

  if(!form){
    console.error('Kiteezi admin login form was not found.');
    return;
  }
  form.addEventListener('submit',signIn);
  window.__KITEEZI_ADMIN_LOGIN_BOUND__=true;
})();
