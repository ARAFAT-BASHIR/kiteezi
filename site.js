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

  function humanError(error, fallback = 'We could not complete that request right now. Please try again.') {
    const message = String(error?.message ?? error ?? '').trim();
    if (!message || message === '[object Object]') return fallback;
    const technical = /(?:supabase|postgrest|pgrst|postgres|sql|schema|relation|column|constraint|permission denied|function .* does not exist|does not exist|http\s*\d{3}|\b(?:3f000|42883|42501|235\d{3})\b|fetch failed|network error|unexpected .* response|syntax error|jwt)/i;
    if (technical.test(message) || /^\s*[\[{].*[\]}]\s*$/.test(message)) return fallback;
    return message;
  }

  async function supabaseFetch(path, options = {}) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error(
        'The website is temporarily unavailable. Please refresh and try again.'
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
        humanError(
          typeof data === 'string'
            ? data
            : data?.message || data?.error_description,
          'We could not load the latest information right now. Please refresh and try again.'
        )
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
        'This menu item is no longer available. Please refresh the menu and try again.'
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

  const MENU_CACHE_KEY = 'kiteezi_public_menu_cache_v1';
  const MENU_CACHE_TTL = 30000;
  let menuItemsPromise = null;

  async function getMenuItems() {
    if (menuItemsPromise) return menuItemsPromise;

    menuItemsPromise = (async () => {
      try {
        const cached = JSON.parse(sessionStorage.getItem(MENU_CACHE_KEY) || 'null');
        if (cached && Number(cached.savedAt) + MENU_CACHE_TTL > Date.now() && Array.isArray(cached.rows)) {
          return cached.rows;
        }
      } catch {}

      const rows = await supabaseFetch(
        '/rest/v1/menu_items?select=id,name,description,price,price_on_request,in_stock,img_url,alt_text,category_id,serving_unit,menu_categories(name,sort_order)&in_stock=eq.true&order=name.asc'
      );

      try {
        sessionStorage.setItem(MENU_CACHE_KEY, JSON.stringify({
          savedAt: Date.now(),
          rows: Array.isArray(rows) ? rows : []
        }));
      } catch {}

      return rows;
    })();

    try {
      return await menuItemsPromise;
    } catch (error) {
      menuItemsPromise = null;
      throw error;
    }
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
        const price = onRequest ? 'Ask' : 'UGX ' + money(item.price); const serving = item.serving_unit ? ' / ' + escapeHtml(item.serving_unit) : '';
        return '<article class="card"><div class="card-body"><span class="badge">' +
          escapeHtml(item.menu_categories?.name || 'Menu') + '</span><h4>' +
          escapeHtml(item.name) + '</h4><p>' + escapeHtml(item.description || '') +
          '</p><div class="menu-price">' + price + serving + '</div></div></article>';
      }).join('');
    } catch (error) {
      console.error(error);
      target.innerHTML = '<p class="muted">Unable to load menu information.</p>';
    }
  }

  // Select photography from the specific dish name first. Do not use one generic
  // category photo for every item.
  const MENU_IMAGE_MAP = {
    coffee: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=900&q=80',
    katogo: 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80',
    rolex: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=900&q=80',
    samosa: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=900&q=80',
    masala_chips: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?auto=format&fit=crop&w=900&q=80',
    chicken_wings: 'https://images.unsplash.com/photo-1527477396000-e27163b481c2?auto=format&fit=crop&w=900&q=80',
    chicken_curry: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=900&q=80',
    chicken_pilawo: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=80',
    grilled_chicken: 'https://images.unsplash.com/photo-1532550907401-a500c9a57435?auto=format&fit=crop&w=900&q=80',
    burger: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80',
    pizza: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80',
    fish: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=900&q=80',
    salad: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=80',
    juice: 'https://images.unsplash.com/photo-1613478223719-2ab802602423?auto=format&fit=crop&w=900&q=80',
    milkshake: 'https://images.unsplash.com/photo-1572490122747-3968b75cc699?auto=format&fit=crop&w=900&q=80',
    beer: 'https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&w=900&q=80',
    wine: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=900&q=80',
    spirits: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?auto=format&fit=crop&w=900&q=80',
    default: 'images/menu-placeholder.svg'
  };

  const stableLock = value => {
    let hash = 2166136261;
    for (const ch of String(value || '').toLowerCase()) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
    return Math.abs(hash >>> 0) + 1;
  };

  function menuImageFor(item) {
    if (item?.img_url && /^https?:\/\//i.test(String(item.img_url))) return String(item.img_url);
    const name = String(item?.name || '').trim();
    const hay = (name + ' ' + String(item?.menu_categories?.name || '')).toLowerCase();
    const exact = [
      [/katogo/, MENU_IMAGE_MAP.katogo],
      [/rolex/, MENU_IMAGE_MAP.rolex],
      [/coffee|tea/, MENU_IMAGE_MAP.coffee],
      [/samosa/, MENU_IMAGE_MAP.samosa],
      [/masala.*chips/, MENU_IMAGE_MAP.masala_chips],
      [/chicken.*wings|wings/, MENU_IMAGE_MAP.chicken_wings],
      [/chicken.*pilawo|pilawo|pilau/, MENU_IMAGE_MAP.chicken_pilawo],
      [/indian.*curry.*chicken|chicken.*curry/, MENU_IMAGE_MAP.chicken_curry],
      [/grilled chicken/, MENU_IMAGE_MAP.grilled_chicken],
      [/burger/, MENU_IMAGE_MAP.burger],
      [/pizza/, MENU_IMAGE_MAP.pizza],
      [/fish/, MENU_IMAGE_MAP.fish],
      [/salad/, MENU_IMAGE_MAP.salad],
      [/juice/, MENU_IMAGE_MAP.juice],
      [/milkshake|milk shake/, MENU_IMAGE_MAP.milkshake],
      [/beer|lager|stout|cider/, MENU_IMAGE_MAP.beer],
      [/wine/, MENU_IMAGE_MAP.wine],
      [/whisk|gin|vodka|spirit|amarula|baileys|champagne|waragi/, MENU_IMAGE_MAP.spirits]
    ];
    for (const [pattern, url] of exact) if (pattern.test(hay)) return url;

    const keyword = name
      .replace(/\([^)]*\)/g, '')
      .replace(/[^a-z0-9 ]/gi, ' ')
      .replace(/\b(each|pair|big|small|large|glass|shot|whole|ordinary)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || String(item?.menu_categories?.name || 'food');
    if (/drink|juice|soda|water|lemonade|smoothie/.test(hay)) return MENU_IMAGE_MAP.juice;
    if (/coffee|tea|barista/.test(hay)) return MENU_IMAGE_MAP.coffee;
    if (/fish|tilapia/.test(hay)) return MENU_IMAGE_MAP.fish;
    if (/salad|vegetable|fruit/.test(hay)) return MENU_IMAGE_MAP.salad;
    return MENU_IMAGE_MAP.default;
  }

async function renderMenuCatalog() {
    const target = $('#menu-catalog');
    if (!target) return;
    try {
      // Menu items are the critical payload. Optional CMS copy must not
      // prevent the actual menu catalogue from rendering.
      const items = await getMenuItems();
      let pages = [];
      try {
        pages = await supabaseFetch('/rest/v1/cms_pages?select=title,content&slug=eq.menu&published=eq.true&limit=1');
      } catch (cmsError) {
        console.warn('Menu CMS copy unavailable; rendering menu data anyway:', cmsError);
      }
      const content = pages?.[0]?.content || {};
      if ($('[data-menu-title]')) $('[data-menu-title]').textContent = content.hero_title || pages?.[0]?.title || 'Menu';
      if ($('[data-menu-description]')) $('[data-menu-description]').textContent = content.intro || 'Browse the current Kiteezi menu.';
      if ($('[data-menu-intro]')) $('[data-menu-intro]').textContent = content.intro || 'Select meals and drinks to add them to your cart.';

      const search = $('#publicMenuSearch');
      const category = $('#publicMenuCategory');
      const summary = $('#menuResultSummary');
      const clear = $('#clearMenuFilters');

      const groups = new Map();
      (items || []).forEach(item => {
        const cat = item.menu_categories?.name || 'Other';
        if (!groups.has(cat)) groups.set(cat, item.menu_categories || {name: cat, sort_order: 999});
      });
      if (category) {
        category.innerHTML = '<option value="">All categories</option>' +
          Array.from(groups.values())
            .sort((a,b)=>(Number(a.sort_order??999)-Number(b.sort_order??999)) || String(a.name).localeCompare(String(b.name)))
            .map(x => '<option value="' + escapeHtml(x.name) + '">' + escapeHtml(x.name) + '</option>').join('');
      }

      const render = () => {
        const q = String(search?.value || '').trim().toLowerCase();
        const cat = String(category?.value || '');
        const filtered = (items || []).filter(item => {
          const itemCat = item.menu_categories?.name || 'Other';
          const haystack = [item.name, item.description, itemCat, item.serving_unit].map(v => String(v || '').toLowerCase()).join(' ');
          return (!q || haystack.includes(q)) && (!cat || itemCat === cat);
        });

        if (summary) summary.textContent = filtered.length + ' menu item' + (filtered.length === 1 ? '' : 's') + ' shown';

        if (!filtered.length) {
          target.innerHTML = '<p class="muted">No menu items match your search or category. Try another search or choose All categories.</p>';
          return;
        }

        const grouped = new Map();
        filtered.forEach(item => {
          const itemCat = item.menu_categories?.name || 'Other';
          if (!grouped.has(itemCat)) grouped.set(itemCat, []);
          grouped.get(itemCat).push(item);
        });

        target.innerHTML = Array.from(grouped.entries()).map(([catName, rows]) => {
          const card = rows.map(item => {
            const unavailable = item.in_stock === false;
            const onRequest = item.price_on_request === true || Number(item.price || 0) === 0;
            const price = onRequest ? 'Ask' : 'UGX ' + money(item.price);
            const serving = item.serving_unit ? ' / ' + escapeHtml(item.serving_unit) : '';
            const imageUrl = menuImageFor(item);
            const image = '<div class="menu-item-image"><img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(item.alt_text || item.name) + '" loading="lazy" onerror="this.onerror=null;this.src=\'' + escapeHtml(MENU_IMAGE_MAP.default) + '\'"></div>';
            return '<div class="menu-item">' + image +
              '<div><h4>' + escapeHtml(item.name) + '</h4><p>' + escapeHtml(item.description || '') + '</p></div>' +
              '<div class="menu-price">' + price + serving + '</div></div>' +
              '<div class="menu-order-row"><span class="muted">' + price + '</span>' +
              '<button type="button" class="btn btn-dark menu-add" data-add-to-cart data-menu-item-id="' + escapeHtml(item.id) + '"' +
              ((unavailable || onRequest) ? ' disabled' : '') + '>' +
              (unavailable ? 'Unavailable' : onRequest ? 'Price on request' : 'Add to Cart') + '</button></div>';
          }).join('');
          return '<article class="card"><div class="card-body"><span class="badge">' + escapeHtml(catName) + '</span>' + card + '</div></article>';
        }).join('');
        bindMenuButtons();
        bindCartButtons();
      };

      search?.addEventListener('input', render);
      category?.addEventListener('change', render);
      clear?.addEventListener('click', () => {
        if (search) search.value = '';
        if (category) category.value = '';
        render();
      });
      render();
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
        'This menu item is no longer available. Please refresh the menu and try again.'
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
        'This menu item is no longer available. Please refresh the menu and try again.'
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
        humanError(
          error,
          'We could not add this item to your cart. Please refresh the menu and try again.'
        )
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

  function ensureSharedFooter() {
    const footer = document.querySelector('.footer');
    if (!footer) return;
    const compact = footer.querySelector('.copyright') && !footer.querySelector('.footer-grid');
    if (!compact) return;
    footer.innerHTML = `
      <div class="container footer-grid">
        <div>
          <div class="brand footer-brand">
            <span class="brand-mark">K</span>
            <span><span class="brand-name">Kiteezi Recreational Center</span><small>Comfort • Dining • Recreation</small></span>
          </div>
          <p>Swimming, dining, sports, gardens, celebrations and everyday relaxation in Kiteezi.</p>
          <div class="socials" data-social-links aria-label="Social media"></div>
        </div>
        <div><h4>Explore</h4><a href="index.html">Home</a><a href="menu.html">Restaurant &amp; Menu</a><a href="events.html">Events &amp; Catering</a><a href="sports.html">Sports</a><a href="about.html">About Kiteezi</a><a href="gallery.html">Gallery</a></div>
        <div><h4>Swimming</h4><a href="booking.html?service=swimming">Public Swimming</a><a href="swimming-schedule.html">School Swimming</a><a href="inquiry.html?type=coaching">Swimming Training</a><a href="inquiry.html?type=swimming">Swimming Enquiries</a></div>
        <div><h4>Contact</h4><a data-site-setting="phone" href="#">+256 766 529086</a><a data-site-setting-href="information_email" href="#">Information email</a><a data-site-setting-href="bookings_email" href="#">Bookings email</a><a data-site-setting-href="business_email" href="#">Business email</a><a data-site-setting="whatsapp" data-site-setting-href="whatsapp_link" href="#" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><span aria-hidden="true">◉</span></a><a data-site-setting-href="location_url" href="#" target="_blank" rel="noopener noreferrer">Location</a><a href="contact.html">Contact page</a></div>
      </div>
      <div class="container copyright">© <span data-year></span> Kiteezi Recreational Center. All rights reserved.</div>`;
  }

  function ensureBusinessEmailInFooters() {
    document.querySelectorAll('.footer').forEach(footer => {
      const contactHeading = Array.from(footer.querySelectorAll('h4')).find(h => String(h.textContent || '').trim().toLowerCase() === 'contact');
      if (!contactHeading) return;
      const contactColumn = contactHeading.parentElement;
      if (!contactColumn || contactColumn.querySelector('[data-site-setting-href="business_email"]')) return;
      const link = document.createElement('a');
      link.href = '#';
      link.dataset.siteSettingHref = 'business_email';
      link.textContent = 'Business email';
      contactColumn.appendChild(link);
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

  function preventDeadHashLinks() {
    document.addEventListener('click', event => {
      const link = event.target.closest && event.target.closest('a[href="#"]');
      if (!link) return;
      if (!link.dataset.siteSetting && !link.dataset.social) event.preventDefault();
      else if (link.getAttribute('href') === '#') {
        event.preventDefault();
        window.location.href = 'contact.html';
      }
    });
  }

  function initInquiryAccess() {
    if (document.body.dataset.inquiryAccess === 'true') return;
    document.body.dataset.inquiryAccess = 'true';
    const path = (location.pathname || '').toLowerCase();
    let type = 'general';
    if (path.includes('swimming')) type = 'swimming';
    else if (path.includes('menu') || path.includes('checkout')) type = 'chef';
    else if (path.includes('sports')) type = 'sports';
    else if (path.includes('events')) type = 'events';
    else if (path.includes('booking')) type = 'general';
    if (path.endsWith('/inquiry.html') || path.includes('/admin/')) return;
    const link = document.createElement('a');
    link.href = 'inquiry.html?type=' + encodeURIComponent(type);
    link.className = 'kiteezi-inquiry-float';
    link.textContent = 'Ask a question';
    link.setAttribute('aria-label', 'Ask Kiteezi a question');
    link.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9999;background:#d9b534;color:#10261c;padding:12px 18px;border-radius:999px;font-weight:800;box-shadow:0 6px 18px rgba(0,0,0,.18);text-decoration:none;';
    document.body.appendChild(link);
  }

  function initSiteYear() {
    $$('[data-year]')
      .forEach(element => {
        element.textContent =
          new Date().getFullYear();
      });
  }


  async function renderGalleryPreview() {
    const target = $('#home-gallery-preview'); if (!target) return;
    try {
      const rows = await supabaseFetch('/rest/v1/gallery_items?select=id,title,caption,category,media_type,storage_bucket,storage_path&status=eq.approved&active=eq.true&order=sort_order.asc,created_at.desc&limit=6');
      const cards = (rows||[]).map(x => {
        const url = SUPABASE_URL + '/storage/v1/object/public/' + encodeURIComponent(x.storage_bucket) + '/' + x.storage_path.split('/').map(encodeURIComponent).join('/');
        const media = x.media_type === 'video' ? '<video class="photo" src="' + escapeHtml(url) + '" muted playsinline preload="metadata" controls></video>' : '<img class="photo" src="' + escapeHtml(url) + '" alt="' + escapeHtml(x.title || 'Kiteezi gallery') + '" loading="lazy">';
        return '<article class="card">' + media + '<div class="card-body"><span class="badge">' + escapeHtml(x.category || 'General') + '</span><h3>' + escapeHtml(x.title || 'Kiteezi') + '</h3>' + (x.caption ? '<p>' + escapeHtml(x.caption) + '</p>' : '') + '</div></article>';
      }).join('');
      target.innerHTML = cards || '<p class="muted">Gallery photos and videos will appear here as they are approved.</p>';
    } catch(e) { console.warn('Gallery preview unavailable:',e); target.innerHTML='<p class="muted">Gallery is temporarily unavailable.</p>'; }
  }

  function init() {
    updateCartUI();
    bindMenuButtons();
    bindCartButtons();
    renderMenuCatalog();
    renderHomeMenu();
    initMobileNavigation();
    ensureSharedFooter();
    ensureBusinessEmailInFooters();
    initSiteYear();
    initInquiryAccess();
    preventDeadHashLinks();
    renderGalleryPreview();

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
