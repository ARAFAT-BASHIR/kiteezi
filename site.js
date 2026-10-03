(function () {
  'use strict';

  const C = window.KITEEZI_CONFIG || {};

  const SUPABASE_URL =
    String(C.SUPABASE_URL || '').replace(/\/+$/, '');

  const SUPABASE_KEY =
    String(C.SUPABASE_ANON_KEY || '');

  const CART_KEY = 'kiteezi_cart_v2';

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const money = value =>
    new Intl.NumberFormat('en-UG').format(
      Math.max(0, Number(value) || 0)
    );

  async function supabaseFetch(path, options = {}) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error(
        'Supabase configuration is missing.'
      );
    }

    const response = await fetch(
      SUPABASE_URL + path,
      {
        ...options,

        headers: {
          apikey: SUPABASE_KEY,
          Authorization:
            'Bearer ' + SUPABASE_KEY,

          'Content-Type':
            'application/json',

          ...(options.headers || {})
        }
      }
    );

    const text = await response.text();

    let data = null;

    try {
      data = text
        ? JSON.parse(text)
        : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      throw new Error(
        typeof data === 'string'
          ? data
          : data?.message ||
            data?.error_description ||
            'Supabase request failed.'
      );
    }

    return data;
  }

  function getCart() {
    try {
      const cart =
        JSON.parse(
          localStorage.getItem(
            CART_KEY
          ) || '[]'
        );

      return Array.isArray(cart)
        ? cart
        : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(
      CART_KEY,
      JSON.stringify(cart)
    );

    updateCartUI();
  }

  function cartQuantity() {
    return getCart().reduce(
      (sum, item) =>
        sum +
        Math.max(
          0,
          Number(item.qty) || 0
        ),
      0
    );
  }

  function cartTotal() {
    return getCart().reduce(
      (sum, item) =>
        sum +
        (Number(item.price) || 0) *
        (Number(item.qty) || 0),
      0
    );
  }

  function updateCartUI() {
    const quantity =
      cartQuantity();

    const total =
      cartTotal();

    $$('[data-cart-count]')
      .forEach(element => {
        element.textContent =
          String(quantity);

        element.hidden =
          quantity === 0;
      });

    $$('[data-cart-total]')
      .forEach(element => {
        element.textContent =
          'UGX ' + money(total);
      });
  }

  function addToCart(item) {
    if (!item.id) {
      throw new Error(
        'The menu item has no database ID.'
      );
    }

    const cart = getCart();

    const existing =
      cart.find(entry =>
        String(entry.id) ===
        String(item.id)
      );

    if (existing) {
      existing.qty =
        Math.max(
          1,
          Number(existing.qty) || 0
        ) + 1;
    } else {
      cart.push({
        id: item.id,
        name: item.name,
        price:
          Number(item.price) || 0,
        qty: 1,
        category:
          item.category || ''
      });
    }

    saveCart(cart);
  }

  function removeFromCart(id) {
    saveCart(
      getCart().filter(
        item =>
          String(item.id) !==
          String(id)
      )
    );
  }

  function changeQuantity(id, amount) {
    const cart = getCart();

    const item =
      cart.find(entry =>
        String(entry.id) ===
        String(id)
      );

    if (!item) return;

    item.qty =
      (Number(item.qty) || 0) +
      Number(amount || 0);

    if (item.qty <= 0) {
      removeFromCart(id);
      return;
    }

    saveCart(cart);
  }

  async function getMenuItems() {
    return supabaseFetch(
      '/rest/v1/menu_items?select=id,name,description,price,price_on_request,in_stock,img_url,alt_text,category_id,menu_categories(name,sort_order)&order=name.asc'
    );
  }

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[char]));


  async function renderHomeMenu() {
    const target = $('#home-menu-catalog');
    if (!target) return;
    try {
      const items = await getMenuItems();
      const rows = (items || []).slice(0, 9);
      target.innerHTML = rows.map(item => {
        const onRequest = item.price_on_request === true || Number(item.price || 0) === 0;
        const price = onRequest ? 'Ask' : 'UGX ' + money(item.price);
        return '<article class="card"><div class="card-body"><span class="badge">' +
          escapeHtml(item.menu_categories?.name || 'Menu') + '</span><h4>' +
          escapeHtml(item.name) + '</h4><p>' + escapeHtml(item.description || '') +
          '</p><div class="menu-price">' + price + '</div></div></article>';
      }).join('');
    } catch (error) {
      console.error(error);
      target.innerHTML = '<p class="muted">Unable to load menu information.</p>';
    }
  }

  async function renderMenuCatalog() {
    const target = $('#menu-catalog');
    if (!target) return;
    try {
      const [items, pages] = await Promise.all([
        getMenuItems(),
        supabaseFetch('/rest/v1/cms_pages?select=title,content&slug=eq.menu&published=eq.true&limit=1')
      ]);
      const content = pages?.[0]?.content || {};
      if ($('[data-menu-title]')) $('[data-menu-title]').textContent = content.hero_title || pages?.[0]?.title || 'Menu';
      if ($('[data-menu-description]')) $('[data-menu-description]').textContent = content.intro || 'Browse the current Kiteezi menu.';
      if ($('[data-menu-intro]')) $('[data-menu-intro]').textContent = content.intro || 'Select meals and drinks to add them to your cart.';
      const groups = new Map();
      (items || []).forEach(item => {
        const category = item.menu_categories?.name || 'Other';
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(item);
      });
      if (!groups.size) {
        target.innerHTML = '<p class="muted">No menu items are currently published.</p>';
        return;
      }
      target.innerHTML = Array.from(groups.entries()).map(([category, rows]) => {
        const card = rows.map(item => {
          const unavailable = item.in_stock === false;
          const onRequest = item.price_on_request === true || Number(item.price || 0) === 0;
          const price = onRequest ? 'Ask' : 'UGX ' + money(item.price);
          const image = item.img_url
            ? '<div class="menu-item-image"><img src="' + escapeHtml(item.img_url) + '" alt="' + escapeHtml(item.alt_text || item.name) + '" loading="lazy"></div>'
            : '';
          return '<div class="menu-item">' + image +
            '<div><h4>' + escapeHtml(item.name) + '</h4><p>' + escapeHtml(item.description || '') + '</p></div>' +
            '<div class="menu-price">' + price + '</div></div>' +
            '<div class="menu-order-row"><span class="muted">' + price + '</span>' +
            '<button type="button" class="btn btn-dark menu-add" data-add-to-cart data-menu-item-id="' + escapeHtml(item.id) + '"' +
            ((unavailable || onRequest) ? ' disabled' : '') + '>' +
            (unavailable ? 'Unavailable' : onRequest ? 'Price on request' : 'Add to Cart') + '</button></div>';
        }).join('');
        return '<article class="card"><div class="card-body"><span class="badge">' +
          escapeHtml(category) + '</span>' + card + '</div></article>';
      }).join('');
      bindMenuButtons();
      bindCartButtons();
    } catch (error) {
      console.error(error);
      target.innerHTML = '<p class="muted">Unable to load the menu right now. Please try again later.</p>';
    }
  }


  async function resolveMenuItem(button) {
    const databaseId =
      button.dataset.menuItemId;

    const productName =
      button.dataset.productName ||
      button.dataset.menuName;

    if (databaseId) {
      const rows =
        await supabaseFetch(
          '/rest/v1/menu_items' +
          '?select=id,name,description,price,in_stock,category_id' +
          '&id=eq.' +
          encodeURIComponent(
            databaseId
          )
        );

      if (rows?.length) {
        return rows[0];
      }
    }

    if (!productName) {
      throw new Error(
        'This menu button is missing its menu item name.'
      );
    }

    const rows =
      await supabaseFetch(
        '/rest/v1/menu_items' +
        '?select=id,name,description,price,in_stock,category_id' +
        '&name=eq.' +
        encodeURIComponent(
          productName
        )
      );

    if (!rows?.length) {
      throw new Error(
        '"' +
        productName +
        '" does not exist in the Kiteezi menu database.'
      );
    }

    return rows[0];
  }

  async function handleAddToCart(button) {
    if (button.disabled) return;

    const original =
      button.textContent;

    button.disabled = true;
    button.textContent =
      'Adding…';

    try {
      const item =
        await resolveMenuItem(
          button
        );

      if (item.in_stock === false) {
        throw new Error(
          'This item is currently unavailable.'
        );
      }

      addToCart({
        id: item.id,
        name: item.name,
        price: item.price,
        category:
          item.category_id
      });

      button.textContent =
        'Added ✓';

      setTimeout(() => {
        button.textContent =
          original;
      }, 1000);

    } catch (error) {
      console.error(error);

      alert(
        error.message ||
        'Unable to add this item to the cart.'
      );

      button.textContent =
        original;

    } finally {
      button.disabled = false;
    }
  }

  function bindMenuButtons() {
    $$('[data-add-to-cart]')
      .forEach(button => {

        if (
          button.dataset.cartBound ===
          'true'
        ) {
          return;
        }

        button.dataset.cartBound =
          'true';

        button.addEventListener(
          'click',
          () =>
            handleAddToCart(button)
        );
      });
  }

  function bindCartButtons() {
    $$('[data-cart-open]')
      .forEach(button => {

        if (
          button.dataset.cartBound ===
          'true'
        ) {
          return;
        }

        button.dataset.cartBound =
          'true';

        button.addEventListener(
          'click',
          () => {
            window.location.href =
              'checkout.html';
          }
        );
      });
  }

  function initMobileNavigation() {
    const button =
      $('[data-mobile]');

    const nav =
      $('.links');

    if (!button || !nav) return;

    button.setAttribute(
      'aria-expanded',
      'false'
    );

    button.addEventListener(
      'click',
      () => {

        const open =
          nav.classList.toggle(
            'open'
          );

        button.setAttribute(
          'aria-expanded',
          open
            ? 'true'
            : 'false'
        );
      }
    );
  }

  function initSiteYear() {
    $$('[data-year]')
      .forEach(element => {
        element.textContent =
          new Date().getFullYear();
      });
  }

  function init() {
    updateCartUI();
    bindMenuButtons();
    bindCartButtons();
    renderMenuCatalog();
    renderHomeMenu();
    initMobileNavigation();
    initSiteYear();

    /*
      content.js is the single owner
      of site_settings.
    */
    if (
      window.KiteeziContent &&
      typeof
        window.KiteeziContent.refresh ===
        'function'
    ) {
      window.KiteeziContent.refresh()
        .catch(error => {
          console.warn(
            'Kiteezi content refresh failed:',
            error
          );
        });
    }
  }

  window.Kiteezi = {
    getCart,
    saveCart,
    addToCart,
    removeFromCart,
    changeQuantity,
    cartQuantity,
    cartTotal,
    money,
    getMenuItems,
    supabaseFetch
  };

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      init
    );
  } else {
    init();
  }

})();
function calculateSportsPrice(sportName, players) {
  const name =
    String(sportName || '')
      .trim()
      .toLowerCase();

  const count =
    Math.max(
      0,
      Number(players) || 0
    );

  if (count <= 0) {
    return 0;
  }

  if (name === 'basketball') {
    return count >= 7
      ? count * 3000
      : count * 5000;
  }

  if (name === 'football') {
    return count >= 11
      ? count * 3000
      : count * 5000;
  }

  return 0;
}
