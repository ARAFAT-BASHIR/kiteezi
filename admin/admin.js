'use strict';

/*

* KITEEZI ADMIN APPLICATION
* 
* Uses the exact database structure currently in Supabase.
* 
* Important:
* - bookings uses booking_date + start_time
* - services contains Basketball / Football pricing rules
* - menu_items contains restaurant items
* - profiles controls staff access
* - the browser never receives a service-role key
    */

const SUPABASE_URL =
'https://aldpezvbetliuvagiekg.supabase.co';

const SUPABASE_ANON_KEY =
'sb_publishable_O4khVKMLU4yyoMDfWWH9Yw_Ha7IGHAL';

const loginForm = document.getElementById('loginForm');
const loginMsg = document.getElementById('loginMsg');
const loginView = document.getElementById('loginView');
const app = document.getElementById('app');
const logoutButton = document.getElementById('logout');

let session = null;
let profile = null;

const $ = (selector, root = document) =>
root.querySelector(selector);

const $$ = (selector, root = document) =>
Array.from(root.querySelectorAll(selector));

const money = value =>
new Intl.NumberFormat('en-UG').format(
Math.max(0, Number(value) || 0)
);

const escapeHtml = value =>
String(value ?? '')
.replace(/&/g, '&')
.replace(/</g, '<')
.replace(/>/g, '>')
.replace(/"/g, '"')
.replace(/'/g, ''');

function today() {
return new Date().toISOString().slice(0, 10);
}

function showError(error) {
console.error('Kiteezi admin:', error);
alert(error?.message || 'Something went wrong.');
}

async function supabaseRequest(
path,
options = {},
token = SUPABASE_ANON_KEY
) {
const response = await fetch(
"${SUPABASE_URL}${path}",
{
...options,
headers: {
apikey: SUPABASE_ANON_KEY,
Authorization: "Bearer ${token}",
'Content-Type': 'application/json',
Prefer:
options.method &&
options.method !== 'GET'
? 'return=representation'
: undefined,
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
"Supabase request failed (${response.status})."
);
}

return data;
}

/* =========================================================
AUTHENTICATION
========================================================= */

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
"/rest/v1/profiles?select=id,full_name,phone,role,active,created_at&id=eq.${encodeURIComponent(userId)}&limit=1",
{},
session.access_token
);

if (
!Array.isArray(rows) ||
rows.length !== 1
) {
throw new Error(
'Your account is authenticated but does not have an active Kiteezi staff profile.'
);
}

const staff = rows[0];

if (staff.active !== true) {
throw new Error(
'Your Kiteezi staff profile is inactive.'
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

const who = $('#who');
const rolePill = $('#rolePill');

if (who) {
who.textContent =
"${profile.full_name || 'Staff'} · ${profile.role || 'staff'}";
}

if (rolePill) {
rolePill.textContent =
String(profile.role || 'staff').toUpperCase();
}

initializeAdmin();
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
String(formData.get('email') || '')
.trim()
.toLowerCase();

const password =
String(formData.get('password') || '');

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
button?.textContent || 'Sign in';

try {
if (button) {
button.disabled = true;
button.textContent = 'Signing in…';
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

/* =========================================================
NAVIGATION
========================================================= */

function activateTab(name) {
const target =
document.getElementById(name);

if (!target) {
name = 'dashboard';
}

$$('.tab').forEach(tab => {
tab.classList.toggle(
'active',
tab.id === name
);
});

$$('[data-tab]').forEach(link => {
link.classList.toggle(
'active',
link.dataset.tab === name
);
});

if (history.replaceState) {
history.replaceState(
null,
'',
"#${name}"
);
}

loadTabData(name);
}

function initNavigation() {
$$('[data-tab]').forEach(link => {
link.addEventListener(
'click',
event => {
event.preventDefault();
activateTab(link.dataset.tab);
}
);
});

window.addEventListener(
'hashchange',
() => {
activateTab(
location.hash.replace('#', '') ||
'dashboard'
);
}
);

activateTab(
location.hash.replace('#', '') ||
'dashboard'
);
}

/* =========================================================
GENERIC HELPERS
========================================================= */

function setLoading(id, message = 'Loading…') {
const element =
document.getElementById(id);

if (element) {
element.innerHTML =
"<div class="data-state">${escapeHtml(message)}</div>";
}
}

function openModal(id) {
const modal =
document.getElementById(id);

if (!modal) return;

modal.classList.add('open');
modal.setAttribute(
'aria-hidden',
'false'
);
}

function closeModal(id) {
const modal =
document.getElementById(id);

if (!modal) return;

modal.classList.remove('open');
modal.setAttribute(
'aria-hidden',
'true'
);
}

function initModals() {
$$('[data-close-modal]').forEach(button => {
button.addEventListener(
'click',
() => {
closeModal(
button.dataset.closeModal
);
}
);
});

$$('.modal').forEach(modal => {
modal.addEventListener(
'click',
event => {
if (event.target === modal) {
closeModal(modal.id);
}
}
);
});
}

/* =========================================================
DASHBOARD
========================================================= */

async function loadDashboard() {
try {
const date = today();

const [
  bookings,
  pending,
  orders,
  inventory
] = await Promise.all([

  supabaseRequest(
    `/rest/v1/bookings?select=id&booking_date=eq.${date}`
  ),

  supabaseRequest(
    `/rest/v1/bookings?select=id&status=eq.pending`
  ),

  supabaseRequest(
    `/rest/v1/orders?select=id&status=in.(open,pending)`
  ),

  supabaseRequest(
    `/rest/v1/inventory_items?select=id,reorder_level`
  )
]);

$('#mBookings').textContent =
  bookings?.length || 0;

$('#mPending').textContent =
  pending?.length || 0;

$('#mOrders').textContent =
  orders?.length || 0;

const low =
  (inventory || []).filter(
    item =>
      Number(item.reorder_level || 0) > 0
  );

$('#mLow').textContent =
  low.length;

$('#todayOps').innerHTML = `
  <p>
    <strong>${bookings?.length || 0}</strong>
    booking(s) scheduled for today.
  </p>
  <p>
    <strong>${pending?.length || 0}</strong>
    booking(s) currently pending.
  </p>
`;

$('#systemStatus').innerHTML = `
  <span class="pill">
    Supabase connected
  </span>
  <p class="mini">
    Authenticated as
    ${escapeHtml(profile?.full_name || 'Staff')}.
  </p>
`;

} catch (error) {
$('#systemStatus').innerHTML =
"<span class="danger"> Database connection error: ${escapeHtml(error.message)} </span>";
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
  '?select=id,customer_id,service_id,booking_date,start_time,people,source,status,payment_status,total,notes,created_at,services(name,price,pricing_mode,team_threshold,small_group_price,full_team_price)' +
  '&order=booking_date.desc,start_time.desc';

if (filter !== 'all') {
  query +=
    `&status=eq.${encodeURIComponent(filter)}`;
}

const rows =
  await supabaseRequest(query);

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
      ${rows.map(row => {

        const service =
          Array.isArray(row.services)
            ? row.services[0]
            : row.services;

        let total =
          Number(row.total || 0);

        if (
          service?.pricing_mode ===
          'per_person_team'
        ) {
          const people =
            Number(row.people || 0);

          const threshold =
            Number(
              service.team_threshold || 0
            );

          const unit =
            people < threshold
              ? Number(
                  service.small_group_price || 0
                )
              : Number(
                  service.full_team_price || 0
                );

          total =
            people * unit;
        }

        return `
          <tr>
            <td>
              ${escapeHtml(row.booking_date)}
            </td>

            <td>
              ${escapeHtml(row.start_time || '—')}
            </td>

            <td>
              ${escapeHtml(service?.name || '—')}
            </td>

            <td>
              ${Number(row.people || 0)}
            </td>

            <td>
              <strong>
                UGX ${money(total)}
              </strong>
            </td>

            <td>
              <span class="pill">
                ${escapeHtml(row.status || 'pending')}
              </span>
            </td>

            <td>
              ${escapeHtml(row.payment_status || 'pending')}
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
      }).join('')}
    </tbody>
  </table>
`;

bindBookingActions();

} catch (error) {
container.innerHTML =
"<div class="data-state danger"> ${escapeHtml(error.message)} </div>";
}
}

function bindBookingActions() {
$$('[data-booking-view]').forEach(button => {
button.addEventListener(
'click',
() =>
viewBooking(
button.dataset.bookingView
)
);
});

$$('[data-booking-confirm]').forEach(button => {
button.addEventListener(
'click',
() =>
updateBookingStatus(
button.dataset.bookingConfirm,
'confirmed'
)
);
});

$$('[data-booking-complete]').forEach(button => {
button.addEventListener(
'click',
() =>
updateBookingStatus(
button.dataset.bookingComplete,
'completed'
)
);
});
}

async function updateBookingStatus(id, status) {
try {
await supabaseRequest(
"/rest/v1/bookings?id=eq.${encodeURIComponent(id)}",
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

async function viewBooking(id) {
try {
const rows =
await supabaseRequest(
"/rest/v1/bookings?select=*,services(name,description,price,pricing_mode,team_threshold,small_group_price,full_team_price)&id=eq.${encodeURIComponent(id)}&limit=1"
);

const booking = rows?.[0];

if (!booking) {
  throw new Error(
    'Booking not found.'
  );
}

const service =
  Array.isArray(booking.services)
    ? booking.services[0]
    : booking.services;

let total =
  Number(booking.total || 0);

if (
  service?.pricing_mode ===
  'per_person_team'
) {
  const people =
    Number(booking.people || 0);

  const threshold =
    Number(service.team_threshold || 0);

  const price =
    people < threshold
      ? Number(service.small_group_price || 0)
      : Number(service.full_team_price || 0);

  total = people * price;
}

$('#bookingDetails').innerHTML = `
  <div class="form-grid">

    <div>
      <strong>Service</strong>
      <p>${escapeHtml(service?.name || '—')}</p>
    </div>

    <div>
      <strong>Date</strong>
      <p>${escapeHtml(booking.booking_date)}</p>
    </div>

    <div>
      <strong>Time</strong>
      <p>${escapeHtml(booking.start_time || '—')}</p>
    </div>

    <div>
      <strong>People</strong>
      <p>${Number(booking.people || 0)}</p>
    </div>

    <div>
      <strong>Status</strong>
      <p>${escapeHtml(booking.status || 'pending')}</p>
    </div>

    <div>
      <strong>Payment</strong>
      <p>${escapeHtml(booking.payment_status || 'pending')}</p>
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
      <p>${escapeHtml(booking.notes || '—')}</p>
    </div>

  </div>
`;

openModal('bookingModal');

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
  '?select=id,customer_id,booking_id,source,status,payment_status,total,created_by,created_at,fulfillment_method,delivery_address,customer_notes' +
  '&order=created_at.desc';

if (filter !== 'all') {
  query +=
    `&status=eq.${encodeURIComponent(filter)}`;
}

const rows =
  await supabaseRequest(query);

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
      ${rows.map(row => `
        <tr>
          <td>
            ${escapeHtml(
              new Date(row.created_at)
                .toLocaleString()
            )}
          </td>

          <td>
            <strong>
              #${escapeHtml(
                String(row.id).slice(0, 8)
              )}
            </strong>
          </td>

          <td>
            ${escapeHtml(row.source || '—')}
          </td>

          <td>
            <span class="pill">
              ${escapeHtml(row.status || 'open')}
            </span>
          </td>

          <td>
            ${escapeHtml(
              row.payment_status || 'pending'
            )}
          </td>

          <td>
            UGX ${money(row.total)}
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
      `).join('')}
    </tbody>
  </table>
`;

$$('[data-order-view]').forEach(button => {
  button.addEventListener(
    'click',
    () =>
      loadOrderItems(
        button.dataset.orderView
      )
  );
});

$$('[data-order-paid]').forEach(button => {
  button.addEventListener(
    'click',
    () =>
      updateOrder(
        button.dataset.orderPaid,
        {
          payment_status: 'paid'
        }
      )
  );
});

} catch (error) {
container.innerHTML =
"<div class="data-state danger"> ${escapeHtml(error.message)} </div>";
}
}

async function loadOrderItems(orderId) {
const container =
$('#orderItemsTable');

container.innerHTML =
'<div class="data-state">Loading items…</div>';

try {
const rows =
await supabaseRequest(
"/rest/v1/order_items?select=id,order_id,menu_item_id,qty,unit_price,notes,menu_items(name)&order_id=eq.${encodeURIComponent(orderId)}"
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
      ${rows.map(row => {

        const menu =
          Array.isArray(row.menu_items)
            ? row.menu_items[0]
            : row.menu_items;

        const total =
          Number(row.qty || 0) *
          Number(row.unit_price || 0);

        return `
          <tr>
            <td>
              ${escapeHtml(menu?.name || 'Unknown item')}
            </td>

            <td>
              ${Number(row.qty || 0)}
            </td>

            <td>
              UGX ${money(row.unit_price)}
            </td>

            <td>
              UGX ${money(total)}
            </td>
          </tr>
        `;
      }).join('')}
    </tbody>
  </table>
`;

} catch (error) {
container.innerHTML =
"<div class="data-state danger"> ${escapeHtml(error.message)} </div>";
}
}

async function updateOrder(id, changes) {
try {
await supabaseRequest(
"/rest/v1/orders?id=eq.${encodeURIComponent(id)}",
{
method: 'PATCH',
body: JSON.stringify(changes)
},
session.access_token
);

await loadOrders();

} catch (error) {
showError(error);
}
}

async function createOrder(event) {
event.preventDefault();

const form =
event.currentTarget;

const data =
Object.fromEntries(
new FormData(form).entries()
);

try {
await supabaseRequest(
'/rest/v1/orders',
{
method: 'POST',
body: JSON.stringify({
customer_id:
data.customer_id || null,

      booking_id:
        data.booking_id || null,

      source:
        data.source || 'admin',

      fulfillment_method:
        data.fulfillment_method || 'counter',

      customer_notes:
        data.customer_notes || null,

      status: 'open',
      payment_status: 'pending',
      total: 0,
      created_by:
        session.user.id
    })
  },
  session.access_token
);

form.reset();
closeModal('orderModal');

await loadOrders();
await loadDashboard();

} catch (error) {
showError(error);
}
}

/* =========================================================
INVENTORY
========================================================= */

async function loadInventory() {
const container =
$('#inventoryTable');

if (!container) return;

container.innerHTML =
'<div class="data-state">Loading inventory…</div>';

try {
const rows =
await supabaseRequest(
'/rest/v1/inventory_items' +
'?select=id,name,unit,category,reorder_level,active' +
'&order=name.asc'
);

const search =
  String(
    $('#inventorySearch')?.value || ''
  ).toLowerCase();

const filter =
  $('#inventoryFilter')?.value ||
  'all';

const filtered =
  (rows || []).filter(item => {

    const matchesSearch =
      !search ||
      String(item.name)
        .toLowerCase()
        .includes(search);

    const isLow =
      Number(item.reorder_level || 0) > 0;

    const matchesFilter =
      filter === 'all' ||
      (filter === 'low' && isLow) ||
      (filter === 'active' && item.active) ||
      (filter === 'inactive' && !item.active);

    return (
      matchesSearch &&
      matchesFilter
    );
  });

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
        <th>Category</th>
        <th>Reorder level</th>
        <th>Active</th>
        <th>Actions</th>
      </tr>
    </thead>

    <tbody>
      ${filtered.map(item => `
        <tr>
          <td>
            <strong>
              ${escapeHtml(item.name)}
            </strong>
          </td>

          <td>
            ${escapeHtml(item.unit)}
          </td>

          <td>
            ${escapeHtml(item.category || '—')}
          </td>

          <td>
            ${Number(item.reorder_level || 0)}
          </td>

          <td>
            ${item.active
              ? '<span class="pill">Active</span>'
              : '<span class="danger">Inactive</span>'}
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
      `).join('')}
    </tbody>
  </table>
`;

$$('[data-inventory-edit]').forEach(button => {
  button.addEventListener(
    'click',
    () =>
      editInventoryItem(
        button.dataset.inventoryEdit
      )
  );
});

$$('[data-stock-view]').forEach(button => {
  button.addEventListener(
    'click',
    () =>
      loadStockMovements(
        button.dataset.stockView
      )
  );
});

} catch (error) {
container.innerHTML =
"<div class="data-state danger"> ${escapeHtml(error.message)} </div>";
}
}

function newInventoryItem() {
const form =
$('#inventoryForm');

form.reset();

form.elements.id.value = '';

openModal('inventoryModal');
}

async function editInventoryItem(id) {
try {
const rows =
await supabaseRequest(
"/rest/v1/inventory_items?select=*&id=eq.${encodeURIComponent(id)}&limit=1"
);

const item = rows?.[0];

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
  item.active ? 'true' : 'false';

openModal('inventoryModal');

} catch (error) {
showError(error);
}
}

async function saveInventoryItem(event) {
event.preventDefault();

const form =
event.currentTarget;

const data =
Object.fromEntries(
new FormData(form).entries()
);

const payload = {
name: data.name,
unit: data.unit,
category: data.category || null,
reorder_level:
Number(data.reorder_level || 0),
active:
data.active === 'true'
};

try {
if (data.id) {
await supabaseRequest(
"/rest/v1/inventory_items?id=eq.${encodeURIComponent(data.id)}",
{
method: 'PATCH',
body: JSON.stringify(payload)
},
session.access_token
);
} else {
await supabaseRequest(
'/rest/v1/inventory_items',
{
method: 'POST',
body: JSON.stringify(payload)
},
session.access_token
);
}

closeModal('inventoryModal');

await loadInventory();
await loadDashboard();

} catch (error) {
showError(error);
}
}

async function loadStockMovements(id) {
const container =
$('#stockMovementsTable');

container.innerHTML =
'<div class="data-state">Loading stock movements…</div>';

try {
const rows =
await supabaseRequest(
"/rest/v1/stock_movements?select=id,quantity,movement_type,reason,supplier,staff_id,created_at&item_id=eq.${encodeURIComponent(id)}&order=created_at.desc"
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
      ${rows.map(row => `
        <tr>
          <td>
            ${escapeHtml(
              new Date(row.created_at)
                .toLocaleString()
            )}
          </td>

          <td>
            ${Number(row.quantity || 0)}
          </td>

          <td>
            ${escapeHtml(
              row.movement_type
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
      `).join('')}
    </tbody>
  </table>
`;

} catch (error) {
container.innerHTML =
"<div class="data-state danger"> ${escapeHtml(error.message)} </div>";
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
  '?select=id,booking_id,session_type,school_name,coach_id,attendance_count,notes,created_at,bookings(booking_date,start_time,people,status)' +
  '&order=created_at.desc';

if (filter !== 'all') {
  query +=
    `&session_type=eq.${encodeURIComponent(filter)}`;
}

const rows =
  await supabaseRequest(query);

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
      ${rows.map(row => {

        const booking =
          Array.isArray(row.bookings)
            ? row.bookings[0]
            : row.bookings;

        return `
          <tr>
            <td>
              ${escapeHtml(
                booking?.booking_date || '—'
              )}
            </td>

            <td>
              ${escapeHtml(
                row.session_type || '—'
              )}
            </td>

            <td>
              ${escapeHtml(
                row.school_name || '—'
              )}
            </td>

            <td>
              ${Number(
                row.attendance_count || 0
              )}
            </td>

            <td>
              <span class="pill">
                ${escapeHtml(
                  booking?.status || '—'
                )}
              </span>
            </td>
          </tr>
        `;
      }).join('')}
    </tbody>
  </table>
`;

} catch (error) {
container.innerHTML =
"<div class="data-state danger"> ${escapeHtml(error.message)} </div>";
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
  '?select=id,customer_id,event_type,event_date,guests,catering_notes,customer_equipment,status,total,created_at' +
  '&order=event_date.desc';

if (filter !== 'all') {
  query +=
    `&status=eq.${encodeURIComponent(filter)}`;
}

const rows =
  await supabaseRequest(query);

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
      ${rows.map(row => `
        <tr>
          <td>
            ${escapeHtml(
              row.event_date || '—'
            )}
          </td>

          <td>
            ${escapeHtml(
              row.event_type || '—'
            )}
          </td>

          <td>
            ${Number(row.guests || 0)}
          </td>

          <td>
            ${escapeHtml(
              row.catering_notes || '—'
            )}
          </td>

          <td>
            <span class="pill">
              ${escapeHtml(
                row.status || 'pending'
              )}
            </span>
          </td>

          <td>
            UGX ${money(row.total)}
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>
`;

} catch (error) {
container.innerHTML =
"<div class="data-state danger"> ${escapeHtml(error.message)} </div>";
}
}

/* =========================================================
SPORTS + SERVICE PRICING
========================================================= */

async function loadSports() {
const container =
$('#sportsTable');

if (!container) return;

container.innerHTML =
'<div class="data-state">Loading sports…</div>';

try {
const sports =
await supabaseRequest(
'/rest/v1/sports' +
'?select=id,name,description,active' +
'&order=name.asc'
);

const services =
  await supabaseRequest(
    '/rest/v1/services' +
    '?select=id,name,category,description,price,active,duration_minutes,pricing_mode,team_threshold,small_group_price,full_team_price' +
    '&category=eq.sports' +
    '&order=name.asc'
  );

const serviceByName =
  new Map(
    (services || []).map(
      service => [
        String(service.name).toLowerCase(),
        service
      ]
    )
  );

if (!sports?.length) {
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
      ${sports.map(sport => {

        const service =
          serviceByName.get(
            String(sport.name)
              .toLowerCase()
          );

        let pricing =
          service?.price
            ? `UGX ${money(service.price)}`
            : 'Configured by team size';

        if (
          service?.pricing_mode ===
          'per_person_team'
        ) {
          pricing = `
            <strong>
              UGX ${money(service.small_group_price)}
            </strong>
            /person under
            ${Number(service.team_threshold)}

            <br>

            <strong>
              UGX ${money(service.full_team_price)}
            </strong>
            /person at
            ${Number(service.team_threshold)}+
          `;
        }

        return `
          <tr>
            <td>
              <strong>
                ${escapeHtml(sport.name)}
              </strong>
            </td>

            <td>
              ${escapeHtml(
                sport.description || '—'
              )}
            </td>

            <td>
              ${sport.active
                ? '<span class="pill">Active</span>'
                : '<span class="danger">Inactive</span>'}
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
      }).join('')}
    </tbody>
  </table>
`;

$$('[data-service-edit]').forEach(button => {
  button.addEventListener(
    'click',
    () =>
      editService(
        button.dataset.serviceEdit
      )
  );
});

} catch (error) {
container.innerHTML =
"<div class="data-state danger"> ${escapeHtml(error.message)} </div>";
}
}

async function editService(id) {
try {
const rows =
await supabaseRequest(
"/rest/v1/services?select=*&id=eq.${encodeURIComponent(id)}&limit=1"
);

const service = rows?.[0];

if (!service) {
  throw new Error(
    'Service not found.'
  );
}

const name =
  prompt(
    'Service name:',
    service.name
  );

if (name === null) return;

const description =
  prompt(
    'Description:',
    service.description || ''
  );

if (description === null) return;

if (
  service.pricing_mode ===
  'per_person_team'
) {
  const threshold =
    Number(
      prompt(
        'Team threshold:',
        service.team_threshold
      )
    );

  const small =
    Number(
      prompt(
        'Price per person below threshold:',
        service.small_group_price
      )
    );

  const full =
    Number(
      prompt(
        'Price per person at/above threshold:',
        service.full_team_price
      )
    );

  if (
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    !Number.isFinite(small) ||
    small < 0 ||
    !Number.isFinite(full) ||
    full < 0
  ) {
    throw new Error(
      'Invalid sports pricing.'
    );
  }

  await supabaseRequest(
    `/rest/v1/services?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        name,
        description,
        team_threshold: threshold,
        small_group_price: small,
        full_team_price: full
      })
    },
    session.access_token
  );

} else {
  const price =
    Number(
      prompt(
        'Price:',
        service.price || 0
      )
    );

  if (
    !Number.isFinite(price) ||
    price < 0
  ) {
    throw new Error(
      'Invalid price.'
    );
  }

  await supabaseRequest(
    `/rest/v1/services?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        name,
        description,
        price
      })
    },
    session.access_token
  );
}

await loadSports();

} catch (error) {
showError(error);
}
}

/* =========================================================
MENU MANAGEMENT
========================================================= */

function ensureMenuAdminSection() {
if ($('#menu')) return;

const section =
document.createElement('section');

section.id = 'menu';
section.className = 'tab';

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

$('.main')?.appendChild(section);

const settingsLink =
document.querySelector(
'[data-tab="settings"]'
);

if (settingsLink?.parentElement) {
const link =
document.createElement('a');

link.href = '#menu';
link.dataset.tab = 'menu';
link.textContent = 'Menu';

settingsLink.parentElement.insertBefore(
  link,
  settingsLink
);

link.addEventListener(
  'click',
  event => {
    event.preventDefault();
    activateTab('menu');
  }
);

}

$('#refreshMenu')?.addEventListener(
'click',
loadMenu
);

$('#newMenuItem')?.addEventListener(
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
'?select=id,name,description,price,in_stock,category_id,requires_sides,menu_categories(name)' +
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
      ${rows.map(row => {

        const category =
          Array.isArray(row.menu_categories)
            ? row.menu_categories[0]
            : row.menu_categories;

        return `
          <tr>
            <td>
              <strong>
                ${escapeHtml(row.name)}
              </strong>
            </td>

            <td>
              ${escapeHtml(
                category?.name || '—'
              )}
            </td>

            <td>
              ${escapeHtml(
                row.description || '—'
              )}
            </td>

            <td>
              UGX ${money(row.price)}
            </td>

            <td>
              ${row.in_stock
                ? '<span class="pill">In stock</span>'
                : '<span class="danger">Unavailable</span>'}
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
      }).join('')}
    </tbody>
  </table>
`;

$$('[data-menu-edit]').forEach(button => {
  button.addEventListener(
    'click',
    () =>
      editMenuItem(
        button.dataset.menuEdit
      )
  );
});

} catch (error) {
container.innerHTML =
"<div class="data-state danger"> ${escapeHtml(error.message)} </div>";
}
}

async function newMenuItem() {
try {
const name =
prompt(
'Menu item name:'
);

if (!name) return;

const description =
  prompt(
    'Description:'
  ) || '';

const price =
  Number(
    prompt(
      'Price in UGX:',
      '0'
    )
  );

if (
  !Number.isFinite(price) ||
  price < 0
) {
  throw new Error(
    'Invalid price.'
  );
}

const categories =
  await supabaseRequest(
    '/rest/v1/menu_categories?select=id,name&active=eq.true&order=sort_order.asc'
  );

if (!categories?.length) {
  throw new Error(
    'No active menu categories exist.'
  );
}

const categoryText =
  categories
    .map(
      (c, index) =>
        `${index + 1}. ${c.name}`
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
  categories[choice];

if (!category) {
  throw new Error(
    'Invalid category.'
  );
}

await supabaseRequest(
  '/rest/v1/menu_items',
  {
    method: 'POST',
    body: JSON.stringify({
      category_id: category.id,
      name: name.trim(),
      description,
      price,
      requires_sides: false,
      in_stock: true
    })
  },
  session.access_token
);

await loadMenu();

} catch (error) {
showError(error);
}
}

async function editMenuItem(id) {
try {
const rows =
await supabaseRequest(
"/rest/v1/menu_items?select=*&id=eq.${encodeURIComponent(id)}&limit=1"
);

const item = rows?.[0];

if (!item) {
  throw new Error(
    'Menu item not found.'
  );
}

const name =
  prompt(
    'Name:',
    item.name
  );

if (name === null) return;

const description =
  prompt(
    'Description:',
    item.description || ''
  );

if (description === null) return;

const price =
  Number(
    prompt(
      'Price in UGX:',
      item.price
    )
  );

if (
  !Number.isFinite(price) ||
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
  `/rest/v1/menu_items?id=eq.${encodeURIComponent(id)}`,
  {
    method: 'PATCH',
    body: JSON.stringify({
      name: name.trim(),
      description,
      price,
      in_stock: stock
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
SITE SETTINGS
========================================================= */

const SETTING_MAP = {
site_name: 'settingSiteName',
business_name: 'settingSiteName',
contact_phone: 'settingPhone',
phone: 'settingPhone',
contact_email: 'settingEmail',
currency: 'settingCurrency',
address: 'settingAddress',
location: 'settingAddress',
description: 'settingDescription'
};

async function loadSettings() {
try {
const rows =
await supabaseRequest(
'/rest/v1/site_settings?select=key,value&order=key.asc'
);

const settings = {};

(rows || []).forEach(row => {
  settings[row.key] =
    row.value ?? '';
});

const name =
  settings.business_name ||
  settings.site_name ||
  '';

$('#settingSiteName').value =
  name;

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
    ${escapeHtml(profile.full_name || '')}
  </p>

  <p>
    <strong>Role:</strong>
    ${escapeHtml(profile.role || '')}
  </p>

  <p>
    <strong>Phone:</strong>
    ${escapeHtml(profile.phone || '—')}
  </p>
`;

} catch (error) {
showError(error);
}
}

async function saveSettings() {
const values = {
business_name:
$('#settingSiteName').value.trim(),

phone:
  $('#settingPhone').value.trim(),

contact_phone:
  $('#settingPhone').value.trim(),

currency:
  $('#settingCurrency').value.trim() ||
  'UGX',

location:
  $('#settingAddress').value.trim(),

address:
  $('#settingAddress').value.trim(),

description:
  $('#settingDescription').value.trim()

};

try {
for (const [key, value] of Object.entries(values)) {
await supabaseRequest(
"/rest/v1/site_settings?key=eq.${encodeURIComponent(key)}",
{
method: 'PATCH',
body: JSON.stringify({
value,
updated_at:
new Date().toISOString()
})
},
session.access_token
);
}

alert(
  'Site settings saved.'
);

} catch (error) {
showError(error);
}
}

/* =========================================================
REPORTS
========================================================= */

async function generateReport() {
const from =
$('#reportFrom').value ||
today();

const to =
$('#reportTo').value ||
today();

try {
const [
bookings,
orders,
events
] = await Promise.all([

  supabaseRequest(
    `/rest/v1/bookings?select=id,total,status,booking_date&booking_date=gte.${from}&booking_date=lte.${to}`
  ),

  supabaseRequest(
    `/rest/v1/orders?select=id,total,status,created_at&created_at=gte.${from}T00:00:00&created_at=lte.${to}T23:59:59`
  ),

  supabaseRequest(
    `/rest/v1/events?select=id,total,status,event_date&event_date=gte.${from}&event_date=lte.${to}`
  )
]);

const bookingRevenue =
  (bookings || []).reduce(
    (sum, row) =>
      sum + Number(row.total || 0),
    0
  );

const orderRevenue =
  (orders || []).reduce(
    (sum, row) =>
      sum + Number(row.total || 0),
    0
  );

const eventRevenue =
  (events || []).reduce(
    (sum, row) =>
      sum + Number(row.total || 0),
    0
  );

$('#reportBookings').textContent =
  bookings?.length || 0;

$('#reportOrders').textContent =
  orders?.length || 0;

$('#reportEvents').textContent =
  events?.length || 0;

$('#reportRevenue').textContent =
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
        <td>${bookings?.length || 0}</td>
        <td>UGX ${money(bookingRevenue)}</td>
      </tr>

      <tr>
        <td>Restaurant orders</td>
        <td>${orders?.length || 0}</td>
        <td>UGX ${money(orderRevenue)}</td>
      </tr>

      <tr>
        <td>Events</td>
        <td>${events?.length || 0}</td>
        <td>UGX ${money(eventRevenue)}</td>
      </tr>
    </tbody>
  </table>
`;

} catch (error) {
showError(error);
}
}

/* =========================================================
TAB LOADING
========================================================= */

async function loadTabData(name) {
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
"Could not load ${name}:",
error
);
}
}

/* =========================================================
EVENT BINDINGS
========================================================= */

function bindControls() {

$('#refreshBookings')?.addEventListener(
'click',
loadBookings
);

$('#bookingFilter')?.addEventListener(
'change',
loadBookings
);

$('#refreshOrders')?.addEventListener(
'click',
loadOrders
);

$('#orderStatusFilter')?.addEventListener(
'change',
loadOrders
);

$('#newOrder')?.addEventListener(
'click',
() => openModal('orderModal')
);

$('#orderForm')?.addEventListener(
'submit',
createOrder
);

$('#refreshInventory')?.addEventListener(
'click',
loadInventory
);

$('#inventorySearch')?.addEventListener(
'input',
loadInventory
);

$('#inventoryFilter')?.addEventListener(
'change',
loadInventory
);

$('#newInventoryItem')?.addEventListener(
'click',
newInventoryItem
);

$('#inventoryForm')?.addEventListener(
'submit',
saveInventoryItem
);

$('#refreshSwimming')?.addEventListener(
'click',
loadSwimming
);

$('#swimmingFilter')?.addEventListener(
'change',
loadSwimming
);

$('#refreshEvents')?.addEventListener(
'click',
loadEvents
);

$('#eventStatusFilter')?.addEventListener(
'change',
loadEvents
);

$('#refreshSports')?.addEventListener(
'click',
loadSports
);

$('#sportsFilter')?.addEventListener(
'change',
loadSports
);

$('#refreshSettings')?.addEventListener(
'click',
loadSettings
);

$('#saveSettings')?.addEventListener(
'click',
saveSettings
);

$('#generateReport')?.addEventListener(
'click',
generateReport
);
}

/* =========================================================
INITIALIZATION
========================================================= */

let initialized = false;

function initializeAdmin() {
if (initialized) return;

initialized = true;

ensureMenuAdminSection();
initNavigation();
initModals();
bindControls();

const from =
$('#reportFrom');

const to =
$('#reportTo');

if (from) {
from.value = today();
}

if (to) {
to.value = today();
}
}

/* =========================================================
START
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
