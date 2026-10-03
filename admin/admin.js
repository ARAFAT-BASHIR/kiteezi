'use strict';

/*
============================================================
KITEEZI ADMIN PORTAL
============================================================

ONE unified admin application.

Authentication:
- Supabase Auth
- Active profiles row required
- Browser uses publishable/anon key only
- RLS must protect all database operations

Application:
- Dashboard
- Bookings
- Restaurant / POS
- Inventory
- Swimming
- Events
- Sports + pricing
- Menu management
- Reports
- Site settings
============================================================
*/


/* =========================================================
   CONFIGURATION
========================================================= */

const C = window.KITEEZI_CONFIG || {};

const SUPABASE_URL =
  String(
    C.SUPABASE_URL ||
    'https://aldpezvbetliuvagiekg.supabase.co'
  ).replace(/\/+$/, '');

const SUPABASE_ANON_KEY =
  C.SUPABASE_ANON_KEY ||
  'sb_publishable_O4khVKMLU4yyoMDfWWHY9w_Ha7IGHAL';

const SESSION_KEY =
  'kiteezi_admin_session';

const PROFILE_KEY =
  'kiteezi_admin_profile';


/* =========================================================
   DOM
========================================================= */

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


/* =========================================================
   STATE
========================================================= */

let session = null;
let profile = null;
let initialized = false;


/* =========================================================
   GENERIC DOM HELPERS
========================================================= */

const $ = (
  selector,
  root = document
) =>
  root.querySelector(selector);

const $$ = (
  selector,
  root = document
) =>
  Array.from(
    root.querySelectorAll(selector)
  );


/* =========================================================
   GENERIC VALUE HELPERS
========================================================= */

function money(value) {
  return new Intl.NumberFormat(
    'en-UG'
  ).format(
    Math.max(
      0,
      Number(value) || 0
    )
  );
}


function today() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}


function escapeHtml(value) {

  return String(
    value ?? ''
  )
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


function showError(error) {

  console.error(
    'Kiteezi admin:',
    error
  );

  alert(
    error?.message ||
    'Something went wrong.'
  );
}


/* =========================================================
   SUPABASE REQUEST
========================================================= */

async function supabaseRequest(
  path,
  options = {},
  token = SUPABASE_ANON_KEY
) {

  if (
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY
  ) {
    throw new Error(
      'Supabase configuration is missing.'
    );
  }

  const headers = {
    apikey:
      SUPABASE_ANON_KEY,

    Authorization:
      `Bearer ${token}`,

    'Content-Type':
      'application/json'
  };

  if (
    options.method &&
    options.method !== 'GET'
  ) {
    headers.Prefer =
      'return=representation';
  }

  const response =
    await fetch(
      `${SUPABASE_URL}${path}`,
      {
        ...options,
        headers: {
          ...headers,
          ...(options.headers || {})
        }
      }
    );

  const text =
    await response.text();

  let data = null;

  try {

    data =
      text
        ? JSON.parse(text)
        : null;

  } catch {

    data = text;
  }

  if (!response.ok) {

    const message =
      data?.message ||
      data?.msg ||
      data?.error_description ||
      data?.error ||
      (
        typeof data === 'string'
          ? data
          : null
      ) ||
      `Supabase request failed (${response.status}).`;

    throw new Error(message);
  }

  return data;
}


/* =========================================================
   AUTHENTICATION
========================================================= */

async function signIn(
  email,
  password
) {

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
    !result ||
    !result.access_token ||
    !result.user ||
    !result.user.id
  ) {
    throw new Error(
      'Supabase did not return a valid login session.'
    );
  }

  return result;
}


/* =========================================================
   LOAD STAFF PROFILE
========================================================= */

async function loadStaffProfile(
  userId,
  accessToken
) {

  if (
    !userId ||
    !accessToken
  ) {
    throw new Error(
      'Invalid authentication session.'
    );
  }

  const rows =
    await supabaseRequest(
      `/rest/v1/profiles` +
      `?select=id,full_name,phone,role,active,created_at` +
      `&id=eq.${encodeURIComponent(userId)}` +
      `&limit=1`,

      {},

      accessToken
    );

  if (
    !Array.isArray(rows) ||
    rows.length === 0
  ) {
    throw new Error(
      'Your account is authenticated, but no Kiteezi staff profile exists for this account.'
    );
  }

  if (rows.length > 1) {
    throw new Error(
      'Multiple Kiteezi staff profiles were found for this account. Please contact the owner.'
    );
  }

  const staff =
    rows[0];

  if (
    staff.active !== true
  ) {
    throw new Error(
      'Your Kiteezi staff profile is inactive. Ask the owner to activate it.'
    );
  }

  return staff;
}


/* =========================================================
   SESSION
========================================================= */

function saveSession() {

  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify(session)
  );

  sessionStorage.setItem(
    PROFILE_KEY,
    JSON.stringify(profile)
  );
}


function clearSession() {

  sessionStorage.removeItem(
    SESSION_KEY
  );

  sessionStorage.removeItem(
    PROFILE_KEY
  );

  session = null;
  profile = null;
}


/* =========================================================
   LOGIN VIEW
========================================================= */

function showLogin(
  message = ''
) {

  app?.classList.add(
    'hide'
  );

  loginView?.classList.remove(
    'hide'
  );

  if (loginMsg) {

    loginMsg.textContent =
      message || '';

    loginMsg.hidden =
      !message;
  }
}


/* =========================================================
   ADMIN VIEW
========================================================= */

function showAdmin() {

  loginView?.classList.add(
    'hide'
  );

  app?.classList.remove(
    'hide'
  );

  const who =
    $('#who');

  const rolePill =
    $('#rolePill');

  if (who) {

    who.textContent =
      `${profile?.full_name || 'Staff'} · ${
        profile?.role || 'staff'
      }`;
  }

  if (rolePill) {

    rolePill.textContent =
      String(
        profile?.role || 'staff'
      ).toUpperCase();
  }

  const accountDetails =
    $('#accountDetails');

  if (accountDetails) {

    accountDetails.innerHTML = `
      <p>
        <strong>Name:</strong>
        ${escapeHtml(
          profile?.full_name || ''
        )}
      </p>

      <p>
        <strong>Role:</strong>
        ${escapeHtml(
          profile?.role || ''
        )}
      </p>

      <p>
        <strong>Phone:</strong>
        ${escapeHtml(
          profile?.phone || '—'
        )}
      </p>
    `;
  }

  initializeAdmin();
}


/* =========================================================
   LOGIN ERROR NORMALISATION
========================================================= */

function getAuthErrorMessage(
  error
) {

  const message =
    String(
      error?.message || ''
    ).toLowerCase();

  if (
    message.includes('invalid login') ||
    message.includes('invalid credentials') ||
    message.includes('invalid email') ||
    message.includes('invalid password')
  ) {
    return (
      'Incorrect email or password.'
    );
  }

  if (
    message.includes(
      'email not confirmed'
    )
  ) {
    return (
      'Your email address has not been confirmed.'
    );
  }

  if (
    message.includes(
      'staff profile'
    )
  ) {
    return error.message;
  }

  if (
    message.includes(
      'inactive'
    )
  ) {
    return error.message;
  }

  if (
    message.includes(
      'fetch'
    ) ||
    message.includes(
      'network'
    )
  ) {
    return (
      'Unable to connect to Kiteezi. Check your internet connection and try again.'
    );
  }

  return (
    error?.message ||
    'Unable to sign in. Please try again.'
  );
}


/* =========================================================
   LOGIN HANDLER
========================================================= */

async function handleLogin(
  event
) {

  event.preventDefault();

  if (!loginForm) {
    return;
  }

  const formData =
    new FormData(
      loginForm
    );

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

  if (!email) {

    showLogin(
      'Enter your email address.'
    );

    return;
  }

  if (!password) {

    showLogin(
      'Enter your password.'
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

      button.disabled =
        true;

      button.textContent =
        'Signing in…';
    }

    showLogin('');

    clearSession();

    session =
      await signIn(
        email,
        password
      );

    profile =
      await loadStaffProfile(
        session.user.id,
        session.access_token
      );

    saveSession();

    loginForm.reset();

    showAdmin();

    window.dispatchEvent(
      new CustomEvent(
        'kiteezi:admin-ready',
        {
          detail: {
            session,
            profile
          }
        }
      )
    );

  } catch (error) {

    console.error(
      'Kiteezi admin login failed:',
      error
    );

    clearSession();

    showLogin(
      getAuthErrorMessage(
        error
      )
    );

  } finally {

    if (button) {

      button.disabled =
        false;

      button.textContent =
        originalText;
    }
  }
}


/* =========================================================
   LOGOUT
========================================================= */

async function logout() {

  const token =
    session?.access_token;

  try {

    if (token) {

      await supabaseRequest(
        '/auth/v1/logout',
        {
          method: 'POST'
        },
        token
      );
    }

  } catch (error) {

    console.warn(
      'Supabase logout failed:',
      error
    );

  } finally {

    clearSession();

    showLogin();

    if (loginForm) {
      loginForm.reset();
    }

    window.dispatchEvent(
      new Event(
        'kiteezi:admin-logout'
      )
    );
  }
}


/* =========================================================
   RESTORE SESSION
========================================================= */

async function restoreSession() {

  const savedSession =
    sessionStorage.getItem(
      SESSION_KEY
    );

  if (!savedSession) {

    showLogin();

    return;
  }

  try {

    session =
      JSON.parse(
        savedSession
      );

    if (
      !session ||
      !session.access_token ||
      !session.user ||
      !session.user.id
    ) {
      throw new Error(
        'Invalid saved session.'
      );
    }

    profile =
      await loadStaffProfile(
        session.user.id,
        session.access_token
      );

    saveSession();

    showAdmin();

    window.dispatchEvent(
      new CustomEvent(
        'kiteezi:admin-ready',
        {
          detail: {
            session,
            profile
          }
        }
      )
    );

  } catch (error) {

    console.warn(
      'Saved Kiteezi admin session rejected:',
      error
    );

    clearSession();

    showLogin(
      'Your session has expired or is no longer valid. Please sign in again.'
    );
  }
}


/* =========================================================
   NAVIGATION
========================================================= */

function activateTab(
  name
) {

  const target =
    document.getElementById(
      name
    );

  if (!target) {
    name = 'dashboard';
  }

  $$('.tab').forEach(
    tab => {
      tab.classList.toggle(
        'active',
        tab.id === name
      );
    }
  );

  $$('[data-tab]').forEach(
    link => {
      link.classList.toggle(
        'active',
        link.dataset.tab === name
      );
    }
  );

  if (
    location.hash !==
    `#${name}`
  ) {
    history.replaceState(
      null,
      '',
      `#${name}`
    );
  }

  loadTabData(name);
}


function initNavigation() {

  $$('[data-tab]').forEach(
    link => {

      link.addEventListener(
        'click',
        event => {

          event.preventDefault();

          activateTab(
            link.dataset.tab
          );
        }
      );
    }
  );

  window.addEventListener(
    'hashchange',
    () => {

      activateTab(
        location.hash.replace(
          '#',
          ''
        ) ||
        'dashboard'
      );
    }
  );

  activateTab(
    location.hash.replace(
      '#',
      ''
    ) ||
    'dashboard'
  );
}


/* =========================================================
   MODALS
========================================================= */

function openModal(
  id
) {

  const modal =
    document.getElementById(id);

  if (!modal) return;

  modal.classList.add(
    'open'
  );

  modal.setAttribute(
    'aria-hidden',
    'false'
  );
}


function closeModal(
  id
) {

  const modal =
    document.getElementById(id);

  if (!modal) return;

  modal.classList.remove(
    'open'
  );

  modal.setAttribute(
    'aria-hidden',
    'true'
  );
}


function initModals() {

  $$('[data-close-modal]')
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () => {

            closeModal(
              button.dataset.closeModal
            );
          }
        );
      }
    );

  $$('.modal').forEach(
    modal => {

      modal.addEventListener(
        'click',
        event => {

          if (
            event.target === modal
          ) {
            closeModal(
              modal.id
            );
          }
        }
      );
    }
  );
}


/* =========================================================
   DASHBOARD
========================================================= */

async function loadDashboard() {

  try {

    const date =
      today();

    const [
      bookings,
      pending,
      orders,
      movements
    ] =
      await Promise.all([

        supabaseRequest(
          `/rest/v1/bookings` +
          `?select=id` +
          `&booking_date=eq.${date}`
        ),

        supabaseRequest(
          '/rest/v1/bookings' +
          '?select=id' +
          '&status=eq.pending'
        ),

        supabaseRequest(
          '/rest/v1/orders' +
          '?select=id' +
          '&status=in.(open,pending)'
        ),

        supabaseRequest(
          '/rest/v1/stock_movements' +
          '?select=item_id,quantity,movement_type'
        )
      ]);

    $('#mBookings').textContent =
      bookings?.length || 0;

    $('#mPending').textContent =
      pending?.length || 0;

    $('#mOrders').textContent =
      orders?.length || 0;

    /*
      Inventory does not contain a stock column.
      Calculate current quantity from movements.
    */

    const stock =
      {};

    (
      movements || []
    ).forEach(
      movement => {

        const id =
          movement.item_id;

        if (!id) return;

        if (
          !stock[id]
        ) {
          stock[id] = 0;
        }

        const quantity =
          Number(
            movement.quantity || 0
          );

        const type =
          String(
            movement.movement_type || ''
          ).toLowerCase();

        if (
          type === 'out' ||
          type === 'sale' ||
          type === 'usage' ||
          type === 'used' ||
          type === 'remove'
        ) {
          stock[id] -=
            quantity;
        } else {
          stock[id] +=
            quantity;
        }
      }
    );

    const inventory =
      await supabaseRequest(
        '/rest/v1/inventory_items' +
        '?select=id,reorder_level,active'
      );

    const low =
      (
        inventory || []
      ).filter(
        item =>
          item.active !== false &&
          Number(
            stock[item.id] || 0
          ) <= Number(
            item.reorder_level || 0
          )
      );

    $('#mLow').textContent =
      low.length;

    $('#todayOps').innerHTML = `
      <p>
        <strong>
          ${bookings?.length || 0}
        </strong>
        booking(s) scheduled for today.
      </p>

      <p>
        <strong>
          ${pending?.length || 0}
        </strong>
        booking(s) currently pending.
      </p>
    `;

    $('#systemStatus').innerHTML = `
      <span class="pill">
        Supabase connected
      </span>

      <p class="mini">
        Authenticated as
        ${escapeHtml(
          profile?.full_name || 'Staff'
        )}.
      </p>
    `;

  } catch (error) {

    $('#systemStatus').innerHTML = `
      <span class="danger">
        Database connection error:
        ${escapeHtml(
          error.message
        )}
      </span>
    `;
  }
}


/* =========================================================
   BOOKINGS
========================================================= */

async function loadBookings() {

  const container =
    $('#bookingTable');

  if (!container) return;

  container.innerHTML =
    '<div class="data-state">Loading bookings…</div>';

  try {

    const filter =
      $('#bookingFilter')?.value ||
      'all';

    let query =
      '/rest/v1/bookings' +
      '?select=' +
      'id,customer_id,service_id,' +
      'booking_date,start_time,people,' +
      'source,status,payment_status,total,' +
      'notes,created_at,' +
      'services(' +
      'name,price,pricing_mode,' +
      'team_threshold,small_group_price,' +
      'full_team_price' +
      ')' +
      '&order=booking_date.desc,start_time.desc';

    if (
      filter !== 'all'
    ) {

      query +=
        `&status=eq.${encodeURIComponent(
          filter
        )}`;
    }

    const rows =
      await supabaseRequest(
        query
      );

    if (!rows?.length) {

      container.innerHTML =
        '<div class="data-state">No bookings found.</div>';

      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Service</th>
            <th>People</th>
            <th>Total</th>
            <th>Status</th>
            <th>Payment</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(
            row => {

              const service =
                Array.isArray(
                  row.services
                )
                  ? row.services[0]
                  : row.services;

              const total =
                calculateServiceTotal(
                  service,
                  row.people,
                  row.total
                );

              return `
                <tr>

                  <td>
                    ${escapeHtml(
                      row.booking_date
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      row.start_time || '—'
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      service?.name || '—'
                    )}
                  </td>

                  <td>
                    ${Number(
                      row.people || 0
                    )}
                  </td>

                  <td>
                    <strong>
                      UGX ${money(total)}
                    </strong>
                  </td>

                  <td>
                    <span class="pill">
                      ${escapeHtml(
                        row.status ||
                        'pending'
                      )}
                    </span>
                  </td>

                  <td>
                    ${escapeHtml(
                      row.payment_status ||
                      'unpaid'
                    )}
                  </td>

                  <td>
                    <div class="actions">

                      <button
                        class="btn"
                        type="button"
                        data-booking-view="${row.id}"
                      >
                        View
                      </button>

                      <button
                        class="btn"
                        type="button"
                        data-booking-confirm="${row.id}"
                      >
                        Confirm
                      </button>

                      <button
                        class="btn"
                        type="button"
                        data-booking-complete="${row.id}"
                      >
                        Complete
                      </button>

                    </div>
                  </td>

                </tr>
              `;
            }
          ).join('')}
        </tbody>
      </table>
    `;

    bindBookingActions();

  } catch (error) {

    container.innerHTML = `
      <div class="data-state danger">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


function calculateServiceTotal(
  service,
  people,
  storedTotal
) {

  if (
    service?.pricing_mode ===
    'per_person_team'
  ) {

    const count =
      Number(
        people || 0
      );

    const threshold =
      Number(
        service.team_threshold || 0
      );

    const small =
      Number(
        service.small_group_price || 0
      );

    const full =
      Number(
        service.full_team_price || 0
      );

    if (
      threshold > 0
    ) {

      return (
        count <
        threshold
          ? count * small
          : count * full
      );
    }
  }

  if (
    storedTotal !== null &&
    storedTotal !== undefined
  ) {
    return Number(
      storedTotal || 0
    );
  }

  return Number(
    service?.price || 0
  );
}


function bindBookingActions() {

  $$('[data-booking-view]')
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () =>
            viewBooking(
              button.dataset.bookingView
            )
        );
      }
    );

  $$('[data-booking-confirm]')
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () =>
            updateBookingStatus(
              button.dataset.bookingConfirm,
              'confirmed'
            )
        );
      }
    );

  $$('[data-booking-complete]')
    .forEach(
      button => {

        button.addEventListener(
          'click',
          () =>
            updateBookingStatus(
              button.dataset.bookingComplete,
              'completed'
            )
        );
      }
    );
}


async function updateBookingStatus(
  id,
  status
) {

  try {

    await supabaseRequest(
      `/rest/v1/bookings?id=eq.${encodeURIComponent(
        id
      )}`,
      {
        method: 'PATCH',

        body: JSON.stringify({
          status
        })
      },
      session.access_token
    );

    await loadBookings();
    await loadDashboard();

  } catch (error) {

    showError(error);
  }
}


async function viewBooking(
  id
) {

  try {

    const rows =
      await supabaseRequest(
        `/rest/v1/bookings` +
        `?select=*` +
        `,services(` +
        'name,description,price,' +
        'pricing_mode,team_threshold,' +
        'small_group_price,full_team_price' +
        ')' +
        `&id=eq.${encodeURIComponent(id)}` +
        '&limit=1'
      );

    const booking =
      rows?.[0];

    if (!booking) {
      throw new Error(
        'Booking not found.'
      );
    }

    const service =
      Array.isArray(
        booking.services
      )
        ? booking.services[0]
        : booking.services;

    const total =
      calculateServiceTotal(
        service,
        booking.people,
        booking.total
      );

    $('#bookingDetails').innerHTML = `
      <div class="form-grid">

        <div>
          <strong>Service</strong>
          <p>
            ${escapeHtml(
              service?.name || '—'
            )}
          </p>
        </div>

        <div>
          <strong>Date</strong>
          <p>
            ${escapeHtml(
              booking.booking_date
            )}
          </p>
        </div>

        <div>
          <strong>Time</strong>
          <p>
            ${escapeHtml(
              booking.start_time || '—'
            )}
          </p>
        </div>

        <div>
          <strong>People</strong>
          <p>
            ${Number(
              booking.people || 0
            )}
          </p>
        </div>

        <div>
          <strong>Status</strong>
          <p>
            ${escapeHtml(
              booking.status ||
              'pending'
            )}
          </p>
        </div>

        <div>
          <strong>Payment</strong>
          <p>
            ${escapeHtml(
              booking.payment_status ||
              'unpaid'
            )}
          </p>
        </div>

        <div class="full">
          <strong>Total</strong>
          <p>
            <strong>
              UGX ${money(total)}
            </strong>
          </p>
        </div>

        <div class="full">
          <strong>Notes</strong>
          <p>
            ${escapeHtml(
              booking.notes || '—'
            )}
          </p>
        </div>

      </div>
    `;

    openModal(
      'bookingModal'
    );

  } catch (error) {

    showError(error);
  }
}


/* =========================================================
   ORDERS / POS
========================================================= */

async function loadOrders() {

  const container =
    $('#ordersTable');

  if (!container) return;

  container.innerHTML =
    '<div class="data-state">Loading orders…</div>';

  try {

    const filter =
      $('#orderStatusFilter')?.value ||
      'all';

    let query =
      '/rest/v1/orders' +
      '?select=' +
      'id,customer_id,booking_id,source,' +
      'status,payment_status,total,created_by,' +
      'created_at,fulfillment_method,' +
      'delivery_address,customer_notes' +
      '&order=created_at.desc';

    if (
      filter !== 'all'
    ) {

      query +=
        `&status=eq.${encodeURIComponent(
          filter
        )}`;
    }

    const rows =
      await supabaseRequest(
        query
      );

    if (!rows?.length) {

      container.innerHTML =
        '<div class="data-state">No orders found.</div>';

      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Created</th>
            <th>Order</th>
            <th>Source</th>
            <th>Status</th>
            <th>Payment</th>
            <th>Total</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(
            row => `
              <tr>

                <td>
                  ${escapeHtml(
                    row.created_at
                      ? new Date(
                          row.created_at
                        ).toLocaleString()
                      : '—'
                  )}
                </td>

                <td>
                  <strong>
                    #${escapeHtml(
                      String(
                        row.id
                      ).slice(0, 8)
                    )}
                  </strong>
                </td>

                <td>
                  ${escapeHtml(
                    row.source || '—'
                  )}
                </td>

                <td>
                  <span class="pill">
                    ${escapeHtml(
                      row.status || 'open'
                    )}
                  </span>
                </td>

                <td>
                  ${escapeHtml(
                    row.payment_status ||
                    'unpaid'
                  )}
                </td>

                <td>
                  UGX ${money(
                    row.total
                  )}
                </td>

                <td>
                  <button
                    class="btn"
                    type="button"
                    data-order-view="${row.id}"
                  >
                    Items
                  </button>

                  <button
                    class="btn"
                    type="button"
                    data-order-paid="${row.id}"
                  >
                    Mark paid
                  </button>
                </td>

              </tr>
            `
          ).join('')}
        </tbody>
      </table>
    `;

    $$('[data-order-view]')
      .forEach(
        button => {

          button.addEventListener(
            'click',
            () =>
              loadOrderItems(
                button.dataset.orderView
              )
          );
        }
      );

    $$('[data-order-paid]')
      .forEach(
        button => {

          button.addEventListener(
            'click',
            () =>
              updateOrder(
                button.dataset.orderPaid,
                {
                  payment_status:
                    'paid'
                }
              )
          );
        }
      );

  } catch (error) {

    container.innerHTML = `
      <div class="data-state danger">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


async function loadOrderItems(
  orderId
) {

  const container =
    $('#orderItemsTable');

  if (!container) return;

  container.innerHTML =
    '<div class="data-state">Loading items…</div>';

  try {

    const rows =
      await supabaseRequest(
        `/rest/v1/order_items` +
        `?select=` +
        'id,order_id,menu_item_id,' +
        'qty,unit_price,notes,' +
        'menu_items(name)' +
        `&order_id=eq.${encodeURIComponent(
          orderId
        )}`
      );

    if (!rows?.length) {

      container.innerHTML =
        '<div class="data-state">No items on this order.</div>';

      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Qty</th>
            <th>Unit price</th>
            <th>Total</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(
            row => {

              const menu =
                Array.isArray(
                  row.menu_items
                )
                  ? row.menu_items[0]
                  : row.menu_items;

              const total =
                Number(
                  row.qty || 0
                ) *
                Number(
                  row.unit_price || 0
                );

              return `
                <tr>

                  <td>
                    ${escapeHtml(
                      menu?.name ||
                      'Unknown item'
                    )}
                  </td>

                  <td>
                    ${Number(
                      row.qty || 0
                    )}
                  </td>

                  <td>
                    UGX ${money(
                      row.unit_price
                    )}
                  </td>

                  <td>
                    UGX ${money(
                      total
                    )}
                  </td>

                </tr>
              `;
            }
          ).join('')}
        </tbody>
      </table>
    `;

  } catch (error) {

    container.innerHTML = `
      <div class="data-state danger">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


async function updateOrder(
  id,
  changes
) {

  try {

    await supabaseRequest(
      `/rest/v1/orders?id=eq.${encodeURIComponent(
        id
      )}`,
      {
        method: 'PATCH',

        body: JSON.stringify(
          changes
        )
      },
      session.access_token
    );

    await loadOrders();
    await loadDashboard();

  } catch (error) {

    showError(error);
  }
}


async function createOrder(
  event
) {

  event.preventDefault();

  const form =
    event.currentTarget;

  const data =
    Object.fromEntries(
      new FormData(
        form
      ).entries()
    );

  try {

    await supabaseRequest(
      '/rest/v1/orders',
      {
        method: 'POST',

        body: JSON.stringify({

          customer_id:
            data.customer_id ||
            null,

          booking_id:
            data.booking_id ||
            null,

          source:
            data.source ||
            'admin',

          fulfillment_method:
            data.fulfillment_method ||
            'pickup',

          customer_notes:
            data.customer_notes ||
            null,

          status:
            'open',

          payment_status:
            'unpaid',

          total:
            0,

          created_by:
            session.user.id
        })
      },
      session.access_token
    );

    form.reset();

    closeModal(
      'orderModal'
    );

    await loadOrders();
    await loadDashboard();

  } catch (error) {

    showError(error);
  }
}


/* =========================================================
   INVENTORY
========================================================= */

async function getInventoryStockMap() {

  const rows =
    await supabaseRequest(
      '/rest/v1/stock_movements' +
      '?select=item_id,quantity,movement_type'
    );

  const stock =
    {};

  (
    rows || []
  ).forEach(
    row => {

      if (!row.item_id) {
        return;
      }

      if (
        stock[row.item_id] ===
        undefined
      ) {
        stock[row.item_id] =
          0;
      }

      const quantity =
        Number(
          row.quantity || 0
        );

      const type =
        String(
          row.movement_type || ''
        ).toLowerCase();

      if (
        type === 'out' ||
        type === 'sale' ||
        type === 'usage' ||
        type === 'used' ||
        type === 'remove'
      ) {
        stock[row.item_id] -=
          quantity;
      } else {
        stock[row.item_id] +=
          quantity;
      }
    }
  );

  return stock;
}


async function loadInventory() {

  const container =
    $('#inventoryTable');

  if (!container) return;

  container.innerHTML =
    '<div class="data-state">Loading inventory…</div>';

  try {

    const [
      rows,
      stock
    ] =
      await Promise.all([
        supabaseRequest(
          '/rest/v1/inventory_items' +
          '?select=id,name,unit,category,' +
          'reorder_level,active' +
          '&order=name.asc'
        ),

        getInventoryStockMap()
      ]);

    const search =
      String(
        $('#inventorySearch')?.value ||
        ''
      ).toLowerCase();

    const filter =
      $('#inventoryFilter')?.value ||
      'all';

    const filtered =
      (
        rows || []
      ).filter(
        item => {

          const matchesSearch =
            !search ||
            String(
              item.name
            )
              .toLowerCase()
              .includes(
                search
              );

          const current =
            Number(
              stock[item.id] || 0
            );

          const isLow =
            current <=
            Number(
              item.reorder_level || 0
            );

          const matchesFilter =
            filter === 'all' ||
            (
              filter === 'low' &&
              isLow
            ) ||
            (
              filter === 'active' &&
              item.active === true
            ) ||
            (
              filter === 'inactive' &&
              item.active !== true
            );

          return (
            matchesSearch &&
            matchesFilter
          );
        }
      );

    if (!filtered.length) {

      container.innerHTML =
        '<div class="data-state">No inventory items found.</div>';

      return;
    }

    container.innerHTML = `
      <table>

        <thead>
          <tr>
            <th>Name</th>
            <th>Unit</th>
            <th>Current stock</th>
            <th>Reorder level</th>
            <th>Category</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${filtered.map(
            item => {

              const current =
                Number(
                  stock[item.id] || 0
                );

              const isLow =
                current <=
                Number(
                  item.reorder_level || 0
                );

              return `
                <tr>

                  <td>
                    <strong>
                      ${escapeHtml(
                        item.name
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      item.unit
                    )}
                  </td>

                  <td>
                    <strong
                      class="${
                        isLow
                          ? 'danger'
                          : ''
                      }"
                    >
                      ${current}
                    </strong>
                  </td>

                  <td>
                    ${Number(
                      item.reorder_level || 0
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      item.category ||
                      '—'
                    )}
                  </td>

                  <td>
                    ${
                      item.active
                        ? '<span class="pill">Active</span>'
                        : '<span class="danger">Inactive</span>'
                    }
                  </td>

                  <td>
                    <div class="actions">

                      <button
                        class="btn"
                        type="button"
                        data-inventory-edit="${item.id}"
                      >
                        Edit
                      </button>

                      <button
                        class="btn"
                        type="button"
                        data-stock-view="${item.id}"
                      >
                        Stock
                      </button>

                    </div>
                  </td>

                </tr>
              `;
            }
          ).join('')}
        </tbody>

      </table>
    `;

    $$('[data-inventory-edit]')
      .forEach(
        button => {

          button.addEventListener(
            'click',
            () =>
              editInventoryItem(
                button.dataset.inventoryEdit
              )
          );
        }
      );

    $$('[data-stock-view]')
      .forEach(
        button => {

          button.addEventListener(
            'click',
            () =>
              loadStockMovements(
                button.dataset.stockView
              )
          );
        }
      );

  } catch (error) {

    container.innerHTML = `
      <div class="data-state danger">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


function newInventoryItem() {

  const form =
    $('#inventoryForm');

  if (!form) return;

  form.reset();

  form.elements.id.value =
    '';

  openModal(
    'inventoryModal'
  );
}


async function editInventoryItem(
  id
) {

  try {

    const rows =
      await supabaseRequest(
        `/rest/v1/inventory_items` +
        `?select=*` +
        `&id=eq.${encodeURIComponent(id)}` +
        '&limit=1'
      );

    const item =
      rows?.[0];

    if (!item) {
      throw new Error(
        'Inventory item not found.'
      );
    }

    const form =
      $('#inventoryForm');

    form.elements.id.value =
      item.id;

    form.elements.name.value =
      item.name || '';

    form.elements.unit.value =
      item.unit || '';

    form.elements.category.value =
      item.category || '';

    form.elements.reorder_level.value =
      item.reorder_level || 0;

    form.elements.active.value =
      item.active
        ? 'true'
        : 'false';

    openModal(
      'inventoryModal'
    );

  } catch (error) {

    showError(error);
  }
}


async function saveInventoryItem(
  event
) {

  event.preventDefault();

  const form =
    event.currentTarget;

  const data =
    Object.fromEntries(
      new FormData(
        form
      ).entries()
    );

  const payload = {

    name:
      String(
        data.name || ''
      ).trim(),

    unit:
      String(
        data.unit || ''
      ).trim(),

    category:
      String(
        data.category || ''
      ).trim() ||
      null,

    reorder_level:
      Number(
        data.reorder_level || 0
      ),

    active:
      data.active === 'true'
  };

  if (
    !payload.name ||
    !payload.unit
  ) {
    throw new Error(
      'Name and unit are required.'
    );
  }

  try {

    if (data.id) {

      await supabaseRequest(
        `/rest/v1/inventory_items?id=eq.${encodeURIComponent(
          data.id
        )}`,
        {
          method: 'PATCH',

          body:
            JSON.stringify(
              payload
            )
        },
        session.access_token
      );

    } else {

      await supabaseRequest(
        '/rest/v1/inventory_items',
        {
          method: 'POST',

          body:
            JSON.stringify(
              payload
            )
        },
        session.access_token
      );
    }

    closeModal(
      'inventoryModal'
    );

    await loadInventory();
    await loadDashboard();

  } catch (error) {

    showError(error);
  }
}


async function loadStockMovements(
  id
) {

  const container =
    $('#stockMovementsTable');

  if (!container) return;

  container.innerHTML =
    '<div class="data-state">Loading stock movements…</div>';

  try {

    const rows =
      await supabaseRequest(
        `/rest/v1/stock_movements` +
        `?select=id,quantity,movement_type,reason,supplier,staff_id,created_at` +
        `&item_id=eq.${encodeURIComponent(id)}` +
        '&order=created_at.desc'
      );

    if (!rows?.length) {

      container.innerHTML =
        '<div class="data-state">No stock movements recorded.</div>';

      return;
    }

    container.innerHTML = `
      <table>

        <thead>
          <tr>
            <th>Date</th>
            <th>Quantity</th>
            <th>Type</th>
            <th>Reason</th>
            <th>Supplier</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(
            row => `
              <tr>

                <td>
                  ${escapeHtml(
                    row.created_at
                      ? new Date(
                          row.created_at
                        ).toLocaleString()
                      : '—'
                  )}
                </td>

                <td>
                  ${Number(
                    row.quantity || 0
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    row.movement_type ||
                    '—'
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    row.reason || '—'
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    row.supplier || '—'
                  )}
                </td>

              </tr>
            `
          ).join('')}
        </tbody>

      </table>
    `;

  } catch (error) {

    container.innerHTML = `
      <div class="data-state danger">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


/* =========================================================
   SWIMMING
========================================================= */

async function loadSwimming() {

  const container =
    $('#swimmingTable');

  if (!container) return;

  container.innerHTML =
    '<div class="data-state">Loading swimming sessions…</div>';

  try {

    const filter =
      $('#swimmingFilter')?.value ||
      'all';

    let query =
      '/rest/v1/swimming_sessions' +
      '?select=' +
      'id,booking_id,session_type,' +
      'school_name,coach_id,' +
      'attendance_count,notes,created_at,' +
      'bookings(' +
      'booking_date,start_time,people,status' +
      ')' +
      '&order=created_at.desc';

    if (
      filter !== 'all'
    ) {

      query +=
        `&session_type=eq.${encodeURIComponent(
          filter
        )}`;
    }

    const rows =
      await supabaseRequest(
        query
      );

    if (!rows?.length) {

      container.innerHTML =
        '<div class="data-state">No swimming sessions found.</div>';

      return;
    }

    container.innerHTML = `
      <table>

        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>School</th>
            <th>Attendance</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(
            row => {

              const booking =
                Array.isArray(
                  row.bookings
                )
                  ? row.bookings[0]
                  : row.bookings;

              return `
                <tr>

                  <td>
                    ${escapeHtml(
                      booking?.booking_date ||
                      '—'
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      row.session_type ||
                      '—'
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      row.school_name ||
                      '—'
                    )}
                  </td>

                  <td>
                    ${Number(
                      row.attendance_count ||
                      0
                    )}
                  </td>

                  <td>
                    <span class="pill">
                      ${escapeHtml(
                        booking?.status ||
                        '—'
                      )}
                    </span>
                  </td>

                </tr>
              `;
            }
          ).join('')}
        </tbody>

      </table>
    `;

  } catch (error) {

    container.innerHTML = `
      <div class="data-state danger">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


/* =========================================================
   EVENTS
========================================================= */

async function loadEvents() {

  const container =
    $('#eventsTable');

  if (!container) return;

  container.innerHTML =
    '<div class="data-state">Loading events…</div>';

  try {

    const filter =
      $('#eventStatusFilter')?.value ||
      'all';

    let query =
      '/rest/v1/events' +
      '?select=' +
      'id,customer_id,event_type,event_date,' +
      'guests,catering_notes,customer_equipment,' +
      'status,total,created_at' +
      '&order=event_date.desc';

    if (
      filter !== 'all'
    ) {

      query +=
        `&status=eq.${encodeURIComponent(
          filter
        )}`;
    }

    const rows =
      await supabaseRequest(
        query
      );

    if (!rows?.length) {

      container.innerHTML =
        '<div class="data-state">No events found.</div>';

      return;
    }

    container.innerHTML = `
      <table>

        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Guests</th>
            <th>Catering</th>
            <th>Status</th>
            <th>Total</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(
            row => `
              <tr>

                <td>
                  ${escapeHtml(
                    row.event_date ||
                    '—'
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    row.event_type ||
                    '—'
                  )}
                </td>

                <td>
                  ${Number(
                    row.guests || 0
                  )}
                </td>

                <td>
                  ${escapeHtml(
                    row.catering_notes ||
                    '—'
                  )}
                </td>

                <td>
                  <span class="pill">
                    ${escapeHtml(
                      row.status ||
                      'pending'
                    )}
                  </span>
                </td>

                <td>
                  UGX ${money(
                    row.total
                  )}
                </td>

              </tr>
            `
          ).join('')}
        </tbody>

      </table>
    `;

  } catch (error) {

    container.innerHTML = `
      <div class="data-state danger">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


/* =========================================================
   SPORTS + PRICING
========================================================= */

async function loadSports() {

  const container =
    $('#sportsTable');

  if (!container) return;

  container.innerHTML =
    '<div class="data-state">Loading sports…</div>';

  try {

    const filter =
      $('#sportsFilter')?.value ||
      'all';

    const [
      sports,
      services
    ] =
      await Promise.all([

        supabaseRequest(
          '/rest/v1/sports' +
          '?select=id,name,description,active' +
          '&order=name.asc'
        ),

        supabaseRequest(
          '/rest/v1/services' +
          '?select=' +
          'id,name,category,description,price,' +
          'active,duration_minutes,pricing_mode,' +
          'team_threshold,small_group_price,' +
          'full_team_price' +
          '&category=eq.sports' +
          '&order=name.asc'
        )
      ]);

    const filteredSports =
      (
        sports || []
      ).filter(
        sport => {

          if (
            filter === 'active'
          ) {
            return sport.active === true;
          }

          if (
            filter === 'inactive'
          ) {
            return sport.active !== true;
          }

          return true;
        }
      );

    const serviceByName =
      new Map(
        (
          services || []
        ).map(
          service => [
            String(
              service.name
            ).toLowerCase(),
            service
          ]
        )
      );

    if (
      !filteredSports.length
    ) {

      container.innerHTML =
        '<div class="data-state">No sports found.</div>';

      return;
    }

    container.innerHTML = `
      <table>

        <thead>
          <tr>
            <th>Sport</th>
            <th>Description</th>
            <th>Status</th>
            <th>Pricing</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${filteredSports.map(
            sport => {

              const service =
                serviceByName.get(
                  String(
                    sport.name
                  ).toLowerCase()
                );

              let pricing =
                'No pricing configured';

              if (
                service
              ) {

                if (
                  service.pricing_mode ===
                  'per_person_team'
                ) {

                  pricing = `
                    <strong>
                      UGX ${money(
                        service.small_group_price
                      )}
                    </strong>
                    /person below
                    ${Number(
                      service.team_threshold ||
                      0
                    )}

                    <br>

                    <strong>
                      UGX ${money(
                        service.full_team_price
                      )}
                    </strong>
                    /person at
                    ${Number(
                      service.team_threshold ||
                      0
                    )}+
                  `;

                } else {

                  pricing = `
                    <strong>
                      UGX ${money(
                        service.price
                      )}
                    </strong>
                  `;
                }
              }

              return `
                <tr>

                  <td>
                    <strong>
                      ${escapeHtml(
                        sport.name
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      sport.description ||
                      '—'
                    )}
                  </td>

                  <td>
                    ${
                      sport.active
                        ? '<span class="pill">Active</span>'
                        : '<span class="danger">Inactive</span>'
                    }
                  </td>

                  <td>
                    ${pricing}
                  </td>

                  <td>
                    ${
                      service
                        ? `
                          <button
                            class="btn"
                            type="button"
                            data-service-edit="${service.id}"
                          >
                            Edit pricing
                          </button>
                        `
                        : 'No service record'
                    }
                  </td>

                </tr>
              `;
            }
          ).join('')}
        </tbody>

      </table>
    `;

    $$('[data-service-edit]')
      .forEach(
        button => {

          button.addEventListener(
            'click',
            () =>
              editService(
                button.dataset.serviceEdit
              )
          );
        }
      );

  } catch (error) {

    container.innerHTML = `
      <div class="data-state danger">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


async function editService(
  id
) {

  try {

    const rows =
      await supabaseRequest(
        `/rest/v1/services` +
        `?select=*` +
        `&id=eq.${encodeURIComponent(id)}` +
        '&limit=1'
      );

    const service =
      rows?.[0];

    if (!service) {
      throw new Error(
        'Service not found.'
      );
    }

    const name =
      prompt(
        'Service name:',
        service.name || ''
      );

    if (
      name === null
    ) {
      return;
    }

    const description =
      prompt(
        'Description:',
        service.description || ''
      );

    if (
      description === null
    ) {
      return;
    }

    const payload = {
      name:
        name.trim(),

      description:
        description
    };

    if (
      service.pricing_mode ===
      'per_person_team'
    ) {

      const threshold =
        Number(
          prompt(
            'Team threshold:',
            service.team_threshold || 0
          )
        );

      const small =
        Number(
          prompt(
            'Price per person below threshold:',
            service.small_group_price || 0
          )
        );

      const full =
        Number(
          prompt(
            'Price per person at/above threshold:',
            service.full_team_price || 0
          )
        );

      if (
        !Number.isFinite(
          threshold
        ) ||
        threshold <= 0 ||
        !Number.isFinite(
          small
        ) ||
        small < 0 ||
        !Number.isFinite(
          full
        ) ||
        full < 0
      ) {

        throw new Error(
          'Invalid sports pricing.'
        );
      }

      payload.team_threshold =
        threshold;

      payload.small_group_price =
        small;

      payload.full_team_price =
        full;

    } else {

      const price =
        Number(
          prompt(
            'Price:',
            service.price || 0
          )
        );

      if (
        !Number.isFinite(
          price
        ) ||
        price < 0
      ) {

        throw new Error(
          'Invalid price.'
        );
      }

      payload.price =
        price;
    }

    await supabaseRequest(
      `/rest/v1/services?id=eq.${encodeURIComponent(
        id
      )}`,
      {
        method: 'PATCH',

        body:
          JSON.stringify(
            payload
          )
      },
      session.access_token
    );

    await loadSports();

  } catch (error) {

    showError(error);
  }
}


/* =========================================================
   MENU MANAGEMENT
========================================================= */

function ensureMenuAdminSection() {

  if (
    $('#menu')
  ) {
    return;
  }

  const main =
    $('.main');

  if (!main) {
    return;
  }

  const section =
    document.createElement(
      'section'
    );

  section.id =
    'menu';

  section.className =
    'tab';

  section.innerHTML = `
    <div class="panel">

      <div class="toolbar">

        <h2 style="margin-right:auto">
          Menu Management
        </h2>

        <button
          class="btn btn-dark"
          type="button"
          id="refreshMenu"
        >
          Refresh
        </button>

        <button
          class="btn"
          type="button"
          id="newMenuItem"
        >
          Add menu item
        </button>

      </div>

      <div
        id="menuTable"
        class="data-state"
      >
        Loading…
      </div>

    </div>
  `;

  main.appendChild(
    section
  );

  const settingsLink =
    document.querySelector(
      '[data-tab="settings"]'
    );

  const nav =
    settingsLink?.parentElement;

  if (
    nav &&
    !nav.querySelector(
      '[data-tab="menu"]'
    )
  ) {

    const link =
      document.createElement(
        'a'
      );

    link.href =
      '#menu';

    link.dataset.tab =
      'menu';

    link.textContent =
      'Menu';

    nav.insertBefore(
      link,
      settingsLink
    );

    link.addEventListener(
      'click',
      event => {

        event.preventDefault();

        activateTab(
          'menu'
        );
      }
    );
  }

  $('#refreshMenu')
    ?.addEventListener(
      'click',
      loadMenu
    );

  $('#newMenuItem')
    ?.addEventListener(
      'click',
      newMenuItem
    );
}


async function loadMenu() {

  const container =
    $('#menuTable');

  if (!container) return;

  container.innerHTML =
    '<div class="data-state">Loading menu…</div>';

  try {

    const rows =
      await supabaseRequest(
        '/rest/v1/menu_items' +
        '?select=' +
        'id,name,description,price,' +
        'in_stock,category_id,requires_sides,' +
        'menu_categories(name)' +
        '&order=name.asc'
      );

    if (!rows?.length) {

      container.innerHTML =
        '<div class="data-state">No menu items found.</div>';

      return;
    }

    container.innerHTML = `
      <table>

        <thead>
          <tr>
            <th>Item</th>
            <th>Category</th>
            <th>Description</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Actions</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(
            row => {

              const category =
                Array.isArray(
                  row.menu_categories
                )
                  ? row.menu_categories[0]
                  : row.menu_categories;

              return `
                <tr>

                  <td>
                    <strong>
                      ${escapeHtml(
                        row.name
                      )}
                    </strong>
                  </td>

                  <td>
                    ${escapeHtml(
                      category?.name ||
                      '—'
                    )}
                  </td>

                  <td>
                    ${escapeHtml(
                      row.description ||
                      '—'
                    )}
                  </td>

                  <td>
                    UGX ${money(
                      row.price
                    )}
                  </td>

                  <td>
                    ${
                      row.in_stock
                        ? '<span class="pill">In stock</span>'
                        : '<span class="danger">Unavailable</span>'
                    }
                  </td>

                  <td>
                    <button
                      class="btn"
                      type="button"
                      data-menu-edit="${row.id}"
                    >
                      Edit
                    </button>
                  </td>

                </tr>
              `;
            }
          ).join('')}
        </tbody>

      </table>
    `;

    $$('[data-menu-edit]')
      .forEach(
        button => {

          button.addEventListener(
            'click',
            () =>
              editMenuItem(
                button.dataset.menuEdit
              )
          );
        }
      );

  } catch (error) {

    container.innerHTML = `
      <div class="data-state danger">
        ${escapeHtml(
          error.message
        )}
      </div>
    `;
  }
}


async function newMenuItem() {

  try {

    const name =
      prompt(
        'Menu item name:'
      );

    if (!name) {
      return;
    }

    const description =
      prompt(
        'Description:',
        ''
      ) || '';

    const price =
      Number(
        prompt(
          'Price in UGX:',
          '0'
        )
      );

    if (
      !Number.isFinite(
        price
      ) ||
      price < 0
    ) {
      throw new Error(
        'Invalid price.'
      );
    }

    const categories =
      await supabaseRequest(
        '/rest/v1/menu_categories' +
        '?select=id,name' +
        '&active=eq.true' +
        '&order=sort_order.asc'
      );

    if (
      !categories?.length
    ) {
      throw new Error(
        'No active menu categories exist.'
      );
    }

    const categoryText =
      categories
        .map(
          (
            category,
            index
          ) =>
            `${index + 1}. ${
              category.name
            }`
        )
        .join('\n');

    const choice =
      Number(
        prompt(
          `Choose category:\n\n${categoryText}`,
          '1'
        )
      ) - 1;

    const category =
      categories[
        choice
      ];

    if (!category) {
      throw new Error(
        'Invalid category.'
      );
    }

    await supabaseRequest(
      '/rest/v1/menu_items',
      {
        method: 'POST',

        body:
          JSON.stringify({

            category_id:
              category.id,

            name:
              name.trim(),

            description:
              description,

            price:
              price,

            requires_sides:
              false,

            in_stock:
              true
          })
      },
      session.access_token
    );

    await loadMenu();

  } catch (error) {

    showError(error);
  }
}


async function editMenuItem(
  id
) {

  try {

    const rows =
      await supabaseRequest(
        `/rest/v1/menu_items` +
        `?select=*` +
        `&id=eq.${encodeURIComponent(id)}` +
        '&limit=1'
      );

    const item =
      rows?.[0];

    if (!item) {
      throw new Error(
        'Menu item not found.'
      );
    }

    const name =
      prompt(
        'Name:',
        item.name || ''
      );

    if (
      name === null
    ) {
      return;
    }

    const description =
      prompt(
        'Description:',
        item.description || ''
      );

    if (
      description === null
    ) {
      return;
    }

    const price =
      Number(
        prompt(
          'Price in UGX:',
          item.price || 0
        )
      );

    if (
      !Number.isFinite(
        price
      ) ||
      price < 0
    ) {
      throw new Error(
        'Invalid price.'
      );
    }

    const stock =
      confirm(
        'Press OK if the item is in stock.\nPress Cancel to mark it unavailable.'
      );

    await supabaseRequest(
      `/rest/v1/menu_items?id=eq.${encodeURIComponent(
        id
      )}`,
      {
        method: 'PATCH',

        body:
          JSON.stringify({

            name:
              name.trim(),

            description:
              description,

            price:
              price,

            in_stock:
              stock
          })
      },
      session.access_token
    );

    await loadMenu();

  } catch (error) {

    showError(error);
  }
}


/* =========================================================
   SETTINGS
========================================================= */

async function loadSettings() {

  try {

    const rows =
      await supabaseRequest(
        '/rest/v1/site_settings' +
        '?select=key,value' +
        '&order=key.asc'
      );

    const settings =
      {};

    (
      rows || []
    ).forEach(
      row => {

        settings[row.key] =
          row.value ?? '';
      }
    );

    $('#settingSiteName').value =
      settings.business_name ||
      settings.site_name ||
      '';

    $('#settingPhone').value =
      settings.phone ||
      settings.contact_phone ||
      '';

    $('#settingEmail').value =
      settings.email ||
      settings.contact_email ||
      '';

    $('#settingCurrency').value =
      settings.currency ||
      'UGX';

    $('#settingAddress').value =
      settings.location ||
      settings.address ||
      '';

    $('#settingDescription').value =
      settings.description ||
      '';

    $('#accountDetails').innerHTML = `
      <p>
        <strong>Name:</strong>
        ${escapeHtml(
          profile?.full_name || ''
        )}
      </p>

      <p>
        <strong>Role:</strong>
        ${escapeHtml(
          profile?.role || ''
        )}
      </p>

      <p>
        <strong>Phone:</strong>
        ${escapeHtml(
          profile?.phone || '—'
        )}
      </p>
    `;

  } catch (error) {

    showError(error);
  }
}


async function saveSettings() {

  const values = {

    business_name:
      $('#settingSiteName')
        .value
        .trim(),

    phone:
      $('#settingPhone')
        .value
        .trim(),

    contact_phone:
      $('#settingPhone')
        .value
        .trim(),

    email:
      $('#settingEmail')
        .value
        .trim(),

    contact_email:
      $('#settingEmail')
        .value
        .trim(),

    currency:
      $('#settingCurrency')
        .value
        .trim() ||
      'UGX',

    location:
      $('#settingAddress')
        .value
        .trim(),

    address:
      $('#settingAddress')
        .value
        .trim(),

    description:
      $('#settingDescription')
        .value
        .trim()
  };

  try {

    for (
      const [
        key,
        value
      ] of Object.entries(
        values
      )
    ) {

      await supabaseRequest(
        '/rest/v1/site_settings',
        {
          method: 'POST',

          headers: {
            Prefer:
              'resolution=merge-duplicates,return=representation'
          },

          body:
            JSON.stringify({
              key,
              value,
              updated_at:
                new Date()
                  .toISOString()
            })
        },
        session.access_token
      );
    }

    alert(
      'Site settings saved.'
    );

    await loadSettings();

  } catch (error) {

    showError(error);
  }
}


/* =========================================================
   REPORTS
========================================================= */

async function generateReport() {

  const from =
    $('#reportFrom')?.value ||
    today();

  const to =
    $('#reportTo')?.value ||
    today();

  try {

    const [
      bookings,
      orders,
      events
    ] =
      await Promise.all([

        supabaseRequest(
          `/rest/v1/bookings` +
          '?select=id,total,status,booking_date' +
          `&booking_date=gte.${from}` +
          `&booking_date=lte.${to}`
        ),

        supabaseRequest(
          `/rest/v1/orders` +
          '?select=id,total,status,created_at' +
          `&created_at=gte.${from}T00:00:00` +
          `&created_at=lte.${to}T23:59:59`
        ),

        supabaseRequest(
          `/rest/v1/events` +
          '?select=id,total,status,event_date' +
          `&event_date=gte.${from}` +
          `&event_date=lte.${to}`
        )
      ]);

    const bookingRevenue =
      (
        bookings || []
      ).reduce(
        (
          sum,
          row
        ) =>
          sum +
          Number(
            row.total || 0
          ),
        0
      );

    const orderRevenue =
      (
        orders || []
      ).reduce(
        (
          sum,
          row
        ) =>
          sum +
          Number(
            row.total || 0
          ),
        0
      );

    const eventRevenue =
      (
        events || []
      ).reduce(
        (
          sum,
          row
        ) =>
          sum +
          Number(
            row.total || 0
          ),
        0
      );

    $('#reportBookings')
      .textContent =
      bookings?.length || 0;

    $('#reportOrders')
      .textContent =
      orders?.length || 0;

    $('#reportEvents')
      .textContent =
      events?.length || 0;

    $('#reportRevenue')
      .textContent =
      `UGX ${money(
        bookingRevenue +
        orderRevenue +
        eventRevenue
      )}`;

    $('#reportTable').innerHTML = `
      <table>

        <thead>
          <tr>
            <th>Area</th>
            <th>Records</th>
            <th>Recorded value</th>
          </tr>
        </thead>

        <tbody>

          <tr>
            <td>Bookings</td>
            <td>
              ${bookings?.length || 0}
            </td>
            <td>
              UGX ${money(
                bookingRevenue
              )}
            </td>
          </tr>

          <tr>
            <td>Restaurant orders</td>
            <td>
              ${orders?.length || 0}
            </td>
            <td>
              UGX ${money(
                orderRevenue
              )}
            </td>
          </tr>

          <tr>
            <td>Events</td>
            <td>
              ${events?.length || 0}
            </td>
            <td>
              UGX ${money(
                eventRevenue
              )}
            </td>
          </tr>

        </tbody>

      </table>
    `;

  } catch (error) {

    showError(error);
  }
}


/* =========================================================
   TAB DATA
========================================================= */

async function loadTabData(
  name
) {

  try {

    switch (name) {

      case 'dashboard':
        await loadDashboard();
        break;

      case 'bookings':
        await loadBookings();
        break;

      case 'restaurant':
        await loadOrders();
        break;

      case 'inventory':
        await loadInventory();
        break;

      case 'swimming':
        await loadSwimming();
        break;

      case 'events':
        await loadEvents();
        break;

      case 'sports':
        await loadSports();
        break;

      case 'menu':
        await loadMenu();
        break;

      case 'reports':
        break;

      case 'settings':
        await loadSettings();
        break;
    }

  } catch (error) {

    console.error(
      `Could not load ${name}:`,
      error
    );
  }
}


/* =========================================================
   EVENT BINDINGS
========================================================= */

function bindControls() {

  $('#refreshBookings')
    ?.addEventListener(
      'click',
      loadBookings
    );

  $('#bookingFilter')
    ?.addEventListener(
      'change',
      loadBookings
    );


  $('#refreshOrders')
    ?.addEventListener(
      'click',
      loadOrders
    );

  $('#orderStatusFilter')
    ?.addEventListener(
      'change',
      loadOrders
    );

  $('#newOrder')
    ?.addEventListener(
      'click',
      () =>
        openModal(
          'orderModal'
        )
    );

  $('#orderForm')
    ?.addEventListener(
      'submit',
      createOrder
    );


  $('#refreshInventory')
    ?.addEventListener(
      'click',
      loadInventory
    );

  $('#inventorySearch')
    ?.addEventListener(
      'input',
      loadInventory
    );

  $('#inventoryFilter')
    ?.addEventListener(
      'change',
      loadInventory
    );

  $('#newInventoryItem')
    ?.addEventListener(
      'click',
      newInventoryItem
    );

  $('#inventoryForm')
    ?.addEventListener(
      'submit',
      saveInventoryItem
    );


  $('#refreshSwimming')
    ?.addEventListener(
      'click',
      loadSwimming
    );

  $('#swimmingFilter')
    ?.addEventListener(
      'change',
      loadSwimming
    );


  $('#refreshEvents')
    ?.addEventListener(
      'click',
      loadEvents
    );

  $('#eventStatusFilter')
    ?.addEventListener(
      'change',
      loadEvents
    );


  $('#refreshSports')
    ?.addEventListener(
      'click',
      loadSports
    );

  $('#sportsFilter')
    ?.addEventListener(
      'change',
      loadSports
    );


  $('#refreshSettings')
    ?.addEventListener(
      'click',
      loadSettings
    );

  $('#saveSettings')
    ?.addEventListener(
      'click',
      saveSettings
    );


  $('#generateReport')
    ?.addEventListener(
      'click',
      generateReport
    );
}


/* =========================================================
   INITIALIZATION
========================================================= */

function initializeAdmin() {

  if (
    initialized
  ) {
    return;
  }

  initialized =
    true;

  ensureMenuAdminSection();

  initNavigation();

  initModals();

  bindControls();

  const from =
    $('#reportFrom');

  const to =
    $('#reportTo');

  if (from) {
    from.value =
      today();
  }

  if (to) {
    to.value =
      today();
  }
}


/* =========================================================
   STARTUP
========================================================= */

loginForm?.addEventListener(
  'submit',
  handleLogin
);

logoutButton?.addEventListener(
  'click',
  logout
);

restoreSession();


/* =========================================================
   PUBLIC AUTH API
========================================================= */

window.KiteeziAdminAuth = {

  getSession() {
    return session;
  },

  getProfile() {
    return profile;
  },

  isAuthenticated() {

    return Boolean(
      session?.access_token &&
      profile?.active === true
    );
  },

  logout
};
