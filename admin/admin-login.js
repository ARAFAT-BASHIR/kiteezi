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
    if(data?.access_token){
      const merged={...old,...data,user:data?.user||old.user,refresh_token:data?.refresh_token||old.refresh_token};
      if(merged?.user?.id){saveSession(merged);return merged}
    }
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
  const forgot=document.getElementById('forgotPassword');
  if(forgot) forgot.addEventListener('click',async()=>{
    const email=String(form.querySelector('[name="email"]')?.value||'').trim();
    if(!email){status('Enter your staff email first, then choose Forgot password.','error');return}
    if(!URL||!KEY){status('Admin configuration is missing. Please contact the site owner.','error');return}
    forgot.disabled=true;
    try{
      const r=await fetch(URL+'/auth/v1/recover',{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({email,redirect_to:location.origin+location.pathname+'?password_reset=1'})});
      const d=await r.json().catch(()=>null);
      if(!r.ok)throw Error(d?.msg||d?.message||'Password recovery could not be started.');
      status('If that staff email exists, a password recovery email has been sent.');
    }catch(err){status(humanLoginError(err,'Password recovery could not be started.'),'error')}
    finally{forgot.disabled=false}
  });
  function setupPasswordToggles(root=document){
    root.querySelectorAll('input[type="password"]:not([data-password-toggle-ready])').forEach(input=>{
      input.dataset.passwordToggleReady='1';
      let wrap=input.closest('.password-field');
      if(!wrap){wrap=document.createElement('span');wrap.className='password-field';input.parentNode.insertBefore(wrap,input);wrap.appendChild(input);}
      let toggle=wrap.querySelector('.password-toggle');
      if(!toggle){toggle=document.createElement('button');toggle.type='button';toggle.className='password-toggle';toggle.textContent='👁';wrap.appendChild(toggle);}
      const sync=()=>{const shown=input.type==='text';toggle.setAttribute('aria-label',shown?'Hide password':'Show password');toggle.setAttribute('aria-pressed',shown?'true':'false');toggle.title=shown?'Hide password':'Show password';toggle.textContent='👁';toggle.classList.toggle('is-visible',shown);};
      toggle.addEventListener('click',()=>{input.type=input.type==='password'?'text':'password';sync();input.focus();});
      sync();
    });
  }
  function watchPasswordFields(){setupPasswordToggles(document);const observer=new MutationObserver(()=>setupPasswordToggles(document));observer.observe(document.body,{childList:true,subtree:true});}
  function setupRecovery(){
    const hash=new URLSearchParams(String(location.hash||'').replace(/^#/,''));
    const token=hash.get('access_token');
    const type=hash.get('type');
    if(!token||type!=='recovery')return;
    const card=form.closest('.login-card')||form.parentElement;
    if(!card)return;
    form.hidden=true;
    const wrap=document.createElement('div');
    wrap.innerHTML='<h3>Set a new password</h3><p class="muted">Choose a new password for your Kiteezi staff account.</p><form id="recoveryForm" class="form"><label>New password<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label>Confirm password<input name="confirm" type="password" minlength="8" autocomplete="new-password" required></label><button class="btn btn-dark">Set password</button><div id="recoveryMsg" class="notice" hidden></div></form>';
    card.appendChild(wrap);
    const rf=document.getElementById('recoveryForm'),rm=document.getElementById('recoveryMsg');
    rf.addEventListener('submit',async e=>{
      e.preventDefault();const fd=new FormData(rf),pw=String(fd.get('password')||''),confirm=String(fd.get('confirm')||'');
      if(pw!==confirm){rm.hidden=false;rm.className='notice danger';rm.textContent='The passwords do not match.';return}
      try{
        const r=await fetch(URL+'/auth/v1/user',{method:'PUT',headers:{apikey:KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
        const d=await r.json().catch(()=>null);if(!r.ok)throw Error(d?.msg||d?.message||'Password could not be reset.');
        rm.hidden=false;rm.className='notice';rm.textContent='Password changed. You can now sign in with your new password.';
        setTimeout(()=>{location.hash='';location.reload()},900);
      }catch(err){rm.hidden=false;rm.className='notice danger';rm.textContent=humanLoginError(err,'Password could not be reset.')}
    });
  }
  if(!form){console.error('Kiteezi admin login form was not found.');return}
  form.addEventListener('submit',signIn,{once:false});
  setupRecovery();
  watchPasswordFields();
  window.__KITEEZI_ADMIN_LOGIN_BOUND__=true;
  window.__KITEEZI_REFRESH_ADMIN_SESSION__=refreshSession;
})();