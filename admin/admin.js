'use strict';

const SUPABASE_URL =
  'https://aldpezvbetliuvagiekg.supabase.co';

const SUPABASE_ANON_KEY =
  'sb_publishable_O4khVKMLU4yyoMDfWWH9Yw_Ha7IGHAL';

const loginForm =
  document.getElementById('loginForm');

const loginMsg =
  document.getElementById('loginMsg');

const loginView =
  document.getElementById('loginView');

const app =
  document.getElementById('app');

const logoutButton =
  document.getElementById('logout');

let session = null;
let profile = null;

async function supabaseRequest(
  path,
  options = {},
  token = SUPABASE_ANON_KEY
) {
  const response = await fetch(
    `${SUPABASE_URL}${path}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.msg ||
      data?.error_description ||
      data?.error ||
      'Supabase request failed.'
    );
  }

  return data;
}

async function signIn(email, password) {
  const result =
    await supabaseRequest(
      '/auth/v1/token?grant_type=password',
      {
        method: 'POST',
        body: JSON.stringify({
          email,
          password
        })
      }
    );

  if (
    !result?.access_token ||
    !result?.user?.id
  ) {
    throw new Error(
      'Authentication did not return a valid session.'
    );
  }

  return result;
}

async function loadStaffProfile(userId) {
  const rows =
    await supabaseRequest(
      `/rest/v1/profiles?select=id,full_name,phone,role,active,created_at&id=eq.${encodeURIComponent(userId)}&limit=1`,
      {},
      session.access_token
    );

  if (
    !Array.isArray(rows) ||
    rows.length !== 1
  ) {
    throw new Error(
      'Your account is authenticated but does not have an active Kiteezi staff profile. Ask the owner to create/activate your profile.'
    );
  }

  const staff = rows[0];

  if (staff.active !== true) {
    throw new Error(
      'Your Kiteezi staff profile is inactive. Ask the owner to activate it.'
    );
  }

  return staff;
}

function showLogin(message = '') {
  app?.classList.add('hide');
  loginView?.classList.remove('hide');

  if (loginMsg) {
    loginMsg.hidden = !message;
    loginMsg.textContent = message;
  }
}

function showAdmin() {
  loginView?.classList.add('hide');
  app?.classList.remove('hide');

  const who =
    document.getElementById('who');

  const rolePill =
    document.getElementById('rolePill');

  if (who) {
    who.textContent =
      `${profile.full_name || 'Staff'} · ${profile.role || 'staff'}`;
  }

  if (rolePill) {
    rolePill.textContent =
      String(profile.role || 'staff')
        .toUpperCase();
  }
}

function saveSession() {
  sessionStorage.setItem(
    'kiteezi_admin_session',
    JSON.stringify(session)
  );

  sessionStorage.setItem(
    'kiteezi_admin_profile',
    JSON.stringify(profile)
  );
}

function clearSession() {
  sessionStorage.removeItem(
    'kiteezi_admin_session'
  );

  sessionStorage.removeItem(
    'kiteezi_admin_profile'
  );

  session = null;
  profile = null;
}

async function handleLogin(event) {
  event.preventDefault();

  const formData =
    new FormData(loginForm);

  const email =
    String(
      formData.get('email') || ''
    )
      .trim()
      .toLowerCase();

  const password =
    String(
      formData.get('password') || ''
    );

  if (!email || !password) {
    showLogin(
      'Enter your email and password.'
    );
    return;
  }

  const button =
    loginForm.querySelector(
      'button[type="submit"]'
    );

  const originalText =
    button?.textContent ||
    'Sign in';

  try {
    if (button) {
      button.disabled = true;
      button.textContent =
        'Signing in…';
    }

    showLogin('');

    session =
      await signIn(
        email,
        password
      );

    profile =
      await loadStaffProfile(
        session.user.id
      );

    saveSession();

    loginForm.reset();

    showAdmin();

  } catch (error) {
    console.error(
      'Kiteezi admin login:',
      error
    );

    clearSession();

    showLogin(
      error.message ||
      'Unable to sign in.'
    );

  } finally {
    if (button) {
      button.disabled = false;
      button.textContent =
        originalText;
    }
  }
}

async function logout() {
  try {
    if (session?.access_token) {
      await supabaseRequest(
        '/auth/v1/logout',
        {
          method: 'POST'
        },
        session.access_token
      );
    }
  } catch (error) {
    console.warn(
      'Logout request failed:',
      error
    );
  }

  clearSession();
  showLogin();
}

async function restoreSession() {
  const savedSession =
    sessionStorage.getItem(
      'kiteezi_admin_session'
    );

  if (!savedSession) {
    showLogin();
    return;
  }

  try {
    session =
      JSON.parse(savedSession);

    if (
      !session?.access_token ||
      !session?.user?.id
    ) {
      throw new Error(
        'Invalid saved session.'
      );
    }

    profile =
      await loadStaffProfile(
        session.user.id
      );

    saveSession();
    showAdmin();

  } catch (error) {
    console.warn(
      'Saved admin session rejected:',
      error
    );

    clearSession();

    showLogin(
      'Your session has expired. Please sign in again.'
    );
  }
}

loginForm?.addEventListener(
  'submit',
  handleLogin
);

logoutButton?.addEventListener(
  'click',
  logout
);

restoreSession();
