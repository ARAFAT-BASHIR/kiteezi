(function () {
  'use strict';

  const C = window.KITEEZI_CONFIG || {};
  const SUPABASE_URL = String(C.SUPABASE_URL || '').replace(/\/+$/, '');
  const SUPABASE_KEY = C.SUPABASE_ANON_KEY || '';
  const CART_KEY = 'kiteezi_cart_v2';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const money = value =>
    new Intl.NumberFormat('en-UG').format(
      Math.max(0, Number(value) || 0)
    );

  async function supabaseFetch(path, options = {}) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('Supabase configuration is missing.');
    }

    const response = await fetch(SUPABASE_URL + path, {
      ...options,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
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
      const cart = JSON.parse(
        localStorage.getItem(CART_KEY) || '[]'
      );

      return Array.isArray(cart) ? cart : [];
    } catch {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartUI();
  }

  function cartQuantity() {
    return getCart().reduce(
      (sum, item) => sum + Math.max(0, Number(item.qty) || 0),
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
    const quantity = cartQuantity();
    const total = cartTotal();

    $$('[data-cart-count]').forEach(element => {
      element.textContent = String(quantity);
      element.hidden = quantity === 0;
    });

    $$('[data-cart-total]').forEach(element => {
      element.textContent = `UGX ${money(total)}`;
    });
  }

  function addToCart(item) {
    if (!item.id) {
      throw new Error('The menu item has no database ID.');
    }

    const cart = getCart();

    const existing = cart.find(
      entry => String(entry.id) === String(item.id)
    );

    if (existing) {
      existing.qty = Math.max(1, Number(existing.qty) || 0) + 1;
    } else {
      cart.push({
        id: item.id,
        name: item.name,
        price: Number(item.price) || 0,
        qty: 1,
        category: item.category || ''
      });
    }

    saveCart(cart);
  }

  function removeFromCart(id) {
    saveCart(
      getCart().filter(
        item => String(item.id) !== String(id)
      )
    );
  }

  function changeQuantity(id, amount) {
    const cart = getCart();

    const item = cart.find(
      entry => String(entry.id) === String(id)
    );

    if (!item) return;

    item.qty = (Number(item.qty) || 0) + Number(amount || 0);

    if (item.qty <= 0) {
      removeFromCart(id);
      return;
    }

    saveCart(cart);
  }

  async function getMenuItems() {
    return await supabaseFetch(
      '/rest/v1/menu_items' +
      '?select=id,name,description,price,in_stock,category_id' +
      '&order=name.asc'
    );
  }

  async function resolveMenuItem(button) {
    const databaseId = button.dataset.menuItemId;
    const productName =
      button.dataset.productName ||
      button.dataset.menuName;

    if (databaseId) {
      const rows = await supabaseFetch(
        '/rest/v1/menu_items' +
        `?select=id,name,description,price,in_stock,category_id&id=eq.${encodeURIComponent(databaseId)}`
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

    const rows = await supabaseFetch(
      '/rest/v1/menu_items' +
      `?select=id,name,description,price,in_stock,category_id&name=eq.${encodeURIComponent(productName)}`
    );

    if (!rows?.length) {
      throw new Error(
        `"${productName}" does not exist in the Kiteezi menu database.`
      );
    }

    return rows[0];
  }

  async function handleAddToCart(button) {
    if (button.disabled) return;

    const original = button.textContent;

    button.disabled = true;
    button.textContent = 'Adding…';

    try {
      const item = await resolveMenuItem(button);

      if (item.in_stock === false) {
        throw new Error('This item is currently unavailable.');
      }

      addToCart({
        id: item.id,
        name: item.name,
        price: item.price,
        category: item.category_id
      });

      button.textContent = 'Added ✓';

      setTimeout(() => {
        button.textContent = original;
      }, 1000);
    } catch (error) {
      console.error(error);

      alert(
        error.message ||
        'Unable to add this item to the cart.'
      );

      button.textContent = original;
    } finally {
      button.disabled = false;
    }
  }

  function bindMenuButtons() {
    $$('[data-add-to-cart]').forEach(button => {
      if (button.dataset.cartBound === 'true') return;

      button.dataset.cartBound = 'true';

      button.addEventListener(
        'click',
        () => handleAddToCart(button)
      );
    });
  }

  function bindCartButtons() {
    $$('[data-cart-open]').forEach(button => {
      if (button.dataset.cartBound === 'true') return;

      button.dataset.cartBound = 'true';

      button.addEventListener('click', () => {
        window.location.href = 'checkout.html';
      });
    });
  }

  function initMobileNavigation() {
    const button = $('[data-mobile]');
    const nav = $('.links');

    if (!button || !nav) return;

    button.addEventListener('click', () => {
      const open = nav.classList.toggle('open');

      button.setAttribute(
        'aria-expanded',
        open ? 'true' : 'false'
      );
    });
  }

  function initSiteYear() {
    $$('[data-year]').forEach(element => {
      element.textContent = new Date().getFullYear();
    });
  }

  async function loadSiteSettings() {
    try {
      const rows = await supabaseFetch(
        '/rest/v1/site_settings?select=key,value'
      );

      if (!Array.isArray(rows)) return;

      rows.forEach(setting => {
        const key = String(setting.key);

        $$(
          `[data-site-setting="${CSS.escape(key)}"]`
        ).forEach(element => {
          const value = setting.value ?? '';

          if (
            element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA'
          ) {
            element.value = value;
          } else {
            element.textContent = value;
          }
        });
      });
    } catch (error) {
      console.warn(
        'Site settings could not be loaded:',
        error
      );
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

  function init() {
    updateCartUI();
    bindMenuButtons();
    bindCartButtons();
    initMobileNavigation();
    initSiteYear();
    loadSiteSettings();
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init
    );
  } else {
    init();
  }
})();
