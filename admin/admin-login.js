'use strict';
(function(){
  if(window.__KITEEZI_ADMIN_LOGIN_BOUND__) return;
  const C=window.KITEEZI_CONFIG||{};
  const URL=String(C.SUPABASE_URL||'').replace(/\/+$/,'');
  const KEY=String(C.SUPABASE_ANON_KEY||'');
  const form=document.getElementById('loginForm');
  const statusEl=document.getElementById('loginMsg');

  function humanLoginError(error,fallback='Sign in could not be completed. Please check your details and try again.'){const m=String(error?.message??error??'').trim();if(!m||m==='[object Object]')return fallback;if(/(?:supabase|postgrest|pgrst|postgres|sql|schema|relation|column|constraint|permission denied|function .* does not exist|does not exist|http\s*\d{3}|\b(?:3f000|42883|42501|235\d{3})\b|fetch failed|network error|unexpected .* response|syntax error|jwt)/i.test(m)||/^\s*[\[{].*[\]}]\s*$/.test(m))return fallback;return m;}
function status(message,kind){
    if(!statusEl)return;
    statusEl.hidden=false;
    statusEl.textContent=message;
    statusEl.className='notice'+(kind==='error'?' danger':'');
  }
  function saveSession(data){const raw=JSON.stringify(data);localStorage.setItem('kiteezi_admin_session',raw);sessionStorage.setItem('kiteezi_admin_session',raw);}
  async function refreshSession(){
    const raw=localStorage.getItem('kiteezi_admin_session')||sessionStorage.getItem('kiteezi_admin_session');
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
        throw Error(humanLoginError(data?.msg||data?.message||data?.error_description));
      }
      if(!data?.access_token||!data?.user?.id)throw Error('Login succeeded but no valid session was returned.');
      const profileResponse=await fetch(URL+'/rest/v1/profiles?select=*&id=eq.'+encodeURIComponent(data.user.id)+'&limit=1',{
        headers:{apikey:KEY,Authorization:'Bearer '+data.access_token,'Content-Type':'application/json'}
      });
      const profiles=await profileResponse.json().catch(()=>null);
      if(!profileResponse.ok)throw Error(humanLoginError(profiles?.message||profiles?.msg,'Unable to verify your staff account. Please try again.'));
      const profile=profiles?.[0];
      if(!profile)throw Error('This account has no Kiteezi staff profile.');
      if(!profile.active)throw Error('This Kiteezi staff profile is inactive.');
      saveSession(data);
      status('Signed in. Opening admin…');
      if(typeof window.KITEEZI_ADMIN_BOOT==='function'){
        const opened=await window.KITEEZI_ADMIN_BOOT(data);
        if(!opened)throw Error('Login succeeded, but the admin dashboard could not be opened.');
      }else{
        window.location.replace(window.location.pathname);
      }
    }catch(err){
      status(humanLoginError(err),'error');
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