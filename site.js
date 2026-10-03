(function () {
  'use strict';

  /* ============================================================
     KITEEZI PUBLIC WEBSITE CORE
     ============================================================

     This file preserves the existing public-site behaviour and
     provides the shared client-side foundation for:

       - Supabase access using the publishable/anon key
       - centralized business settings
       - public navigation
       - mobile navigation
       - contact / WhatsApp enquiries
       - persistent shopping cart
       - cart count and cart drawer
       - menu-item/cart integration
       - existing booking-page compatibility

     IMPORTANT:
       - Never put a Supabase service-role key here.
       - Admin remains separate.
       - Existing HTML remains the fallback.
       - Database writes are only made where the public page
         explicitly requests them.
     ============================================================ */

  const C = window.KITEEZI_CONFIG || {};

  const url = String(C.SUPABASE_URL || '').replace(/\/$/, '');
  const key = C.SUPABASE_ANON_KEY || '';

  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  };

  const CART_KEY = 'kiteezi_cart_v1';

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      match => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[match])
    );

  const money = value =>
    new Intl.NumberFormat('en-UG').format(
      Math.max(0, Number(value) || 0)
    );

  /* ------------------------------------------------------------
     SUPABASE API
     ------------------------------------------------------------ */

  const api = async (path, options = {}) => {
    if (!url || !key) {
      throw new Error(
        'Kiteezi Supabase configuration is missing.'
      );
    }

    const response = await fetch(
      url + '/rest/v1/' + path,
      {
        ...options,
        headers: {
          ...headers,
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
        data?.hint ||
        data?.details ||
        text ||
        ('HTTP ' + response.status)
      );
    }

    return data;
  };

  window.Kiteezi = {
    api,
    esc,
    money
  };

  /* ------------------------------------------------------------
     YEAR
     ------------------------------------------------------------ */

  const year = new Date().getFullYear();

  $$('[data-year]').forEach(element => {
    element.textContent = year;
  });

  $$('[data-current-year]').forEach(element => {
    element.textContent = year;
  });

  /* ------------------------------------------------------------
     PUBLIC NAVIGATION
     ------------------------------------------------------------ */

  const currentPath =
    location.pathname.split('/').pop() ||
    'index.html';

  $$('.links a').forEach(link => {
    const href =
      (link.getAttribute('href') || '')
        .split('?')[0]
        .split('#')[0];

    if (href === currentPath) {
      link.classList.add('active');
    }
  });

  /* ------------------------------------------------------------
     MOBILE MENU
     ------------------------------------------------------------ */

  const mobileButton = $('[data-mobile]');

  if (mobileButton) {
    mobileButton.addEventListener('click', () => {
      const links = $('.links');

      if (!links) {
        return;
      }

      links.classList.toggle('mobile-open');

      mobileButton.setAttribute(
        'aria-expanded',
        links.classList.contains('mobile-open')
          ? 'true'
          : 'false'
      );
    });
  }

  $$('.links a').forEach(link => {
    link.addEventListener('click', () => {
      $('.links')?.classList.remove('mobile-open');
    });
  });

  /* ------------------------------------------------------------
     ADMIN PORTAL PROTECTION
     ------------------------------------------------------------

     The public website must not expose the admin portal through
     public navigation.
     ------------------------------------------------------------ */

  $$('a[href*="admin/"]').forEach(link => {
    link.remove();
  });

  /* ------------------------------------------------------------
     CENTRALIZED SITE SETTINGS
     ------------------------------------------------------------ */

  let siteSettings = {};

  async function loadSiteSettings() {
    try {
      const rows = await api(
        'site_settings?select=key,value'
      );

      siteSettings = Object.fromEntries(
        (rows || []).map(row => [
          row.key,
          row.value
        ])
      );

      applySiteSettings(siteSettings);

      return siteSettings;
    } catch (error) {
      console.warn(
        'Kiteezi site settings unavailable. Existing HTML will remain visible.',
        error
      );

      return {};
    }
  }

  function applySiteSettings(settings) {
    if (!settings || typeof settings !== 'object') {
      return;
    }

    $$('[data-site-setting]').forEach(element => {
      const setting =
        element.dataset.siteSetting;

      if (!(setting in settings)) {
        return;
      }

      const value =
        settings[setting] ?? '';

      if (
        element.matches(
          'input, textarea, select'
        )
      ) {
        element.value = value;
      } else if (
        element.dataset.settingHtml === 'true'
      ) {
        element.innerHTML = String(value);
      } else {
        element.textContent = String(value);
      }
    });

    /* Existing booking/contact pages use these
       more specific data attributes. */

    const businessName =
      settings.business_name ||
      settings.businessName;

    const tagline =
      settings.business_tagline ||
      settings.tagline;

    const location =
      settings.location;

    const phone =
      settings.phone;

    const whatsapp =
      settings.whatsapp ||
      settings.whatsapp_number;

    const whatsappLink =
      settings.whatsapp_link ||
      (
        whatsapp
          ? 'https://wa.me/' +
            String(whatsapp).replace(/[^0-9]/g, '')
          : ''
      );

    if (businessName) {
      $$('[data-site-business-name]')
        .forEach(element => {
          element.textContent = businessName;
        });

      $$('.brand-name')
        .forEach(element => {
          element.textContent = businessName;
        });
    }

    if (tagline) {
      $$('[data-site-tagline]')
        .forEach(element => {
          element.textContent = tagline;
        });
    }

    if (location) {
      $$('[data-site-location]')
        .forEach(element => {
          element.textContent = location;
        });

      $$('.topbar .container span:first-child')
        .forEach(element => {
          element.textContent = location;
        });
    }

    if (phone) {
      $$('[data-site-phone]')
        .forEach(element => {
          element.textContent = phone;
        });

      $$('[data-site-phone-link]')
        .forEach(element => {
          element.href =
            'tel:' +
            String(phone)
              .replace(/[^\d+]/g, '');
        });

      $$('.footer a[href^="tel:"]')
        .forEach(element => {
          element.href =
            'tel:' +
            String(phone)
              .replace(/[^\d+]/g, '');

          if (
            element.children.length === 0
          ) {
            element.textContent = phone;
          }
        });
    }

    if (whatsappLink) {
      $$('[data-site-whatsapp-link]')
        .forEach(element => {
          element.href = whatsappLink;
        });

      $$('.footer a[href*="wa.me/"]')
        .forEach(element => {
          element.href = whatsappLink;

          if (
            whatsapp &&
            element.textContent.trim()
              .toLowerCase()
              .startsWith('whatsapp')
          ) {
            element.textContent =
              'WhatsApp: ' + whatsapp;
          }
        });
    }

    const socialKeys = [
      'facebook',
      'instagram',
      'youtube'
    ];

   
