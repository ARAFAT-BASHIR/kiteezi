(function(){

  /* ============================================================
     KITEEZI PUBLIC WEBSITE CORE
     ============================================================

     This file preserves the existing Kiteezi public-site
     functionality while adding support for centralized
     business/contact settings from Supabase.

     IMPORTANT:
     - Uses the existing Supabase publishable/anon key only.
     - Never put a service-role key in this file.
     - Existing website design/content remains the fallback.
     - Admin portal remains completely separate.
     ============================================================ */

  const C = window.KITEEZI_CONFIG || {};

  const url = (C.SUPABASE_URL || '').replace(/\/$/, '');
  const key = C.SUPABASE_ANON_KEY || '';

  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  };

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

    let data;

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
    esc
  };


  /* ------------------------------------------------------------
     YEAR
     ------------------------------------------------------------ */

  const year = new Date().getFullYear();

  $$('[data-year]').forEach(element => {
    element.textContent = year;
  });


  /* ------------------------------------------------------------
     PUBLIC NAVIGATION
     ------------------------------------------------------------ */

  const path =
    location.pathname.split('/').pop() ||
    'index.html';

  $$('.links a').forEach(link => {

    const href =
      (link.getAttribute('href') || '')
        .split('?')[0];

    if (href === path) {
      link.classList.add('active');
    }

  });


  /* ------------------------------------------------------------
     MOBILE MENU
     ------------------------------------------------------------ */

  const mobileButton =
    $('[data-mobile]');

  if (mobileButton) {

    mobileButton.onclick = () => {

      $('.links')?.classList.toggle(
        'mobile-open'
      );

    };

  }


  /* ------------------------------------------------------------
     ADMIN PORTAL PROTECTION
     ------------------------------------------------------------

     The public website must never expose an admin link.
     The admin portal is accessed separately through /admin/.
     ------------------------------------------------------------ */

  $$('a[href*="admin/"]').forEach(link => {
    link.remove();
  });


  /* ------------------------------------------------------------
     CENTRALIZED BUSINESS SETTINGS
     ------------------------------------------------------------

     Phase 1 introduces site_settings.

     If the table exists and is readable, values are loaded.
     If anything fails, the existing HTML remains untouched.
     ------------------------------------------------------------ */

  let siteSettings = {};

  async function loadSiteSettings() {

    try {

      const rows = await api(
        'site_settings?select=key,value'
      );

      siteSettings =
        Object.fromEntries(
          (rows || []).map(row => [
            row.key,
            row.value
          ])
        );

      applySiteSettings(siteSettings);

      return siteSettings;

    } catch (error) {

      console.warn(
        'Kiteezi site settings unavailable. Existing website content will remain visible.',
        error
      );

      return {};

    }

  }


  function applySiteSettings(settings) {

    if (!settings || typeof settings !== 'object') {
      return;
    }


    /* ----------------------------------------------------------
       Generic data-site-setting support

       Example:

       <span data-site-setting="business_name"></span>
       ---------------------------------------------------------- */

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

        element.innerHTML =
          String(value);

      } else {

        element.textContent =
          String(value);

      }

    });


    /* ----------------------------------------------------------
       TOP BAR LOCATION
       ---------------------------------------------------------- */

    if (settings.location) {

      $$('.topbar .container span:first-child')
        .forEach(element => {
          element.textContent =
            settings.location;
        });

    }


    /* ----------------------------------------------------------
       TOP BAR PHONE
       ---------------------------------------------------------- */

    if (settings.phone) {

      $$('.topbar .container span:last-child')
        .forEach(element => {

          element.textContent =
            'Daily enquiries: ' +
            settings.phone;

        });

    }


    /* ----------------------------------------------------------
       BUSINESS BRAND
       ---------------------------------------------------------- */

    if (settings.business_name) {

      $$('.brand span:not(.brand-mark)')
        .forEach(element => {

          const small =
            element.querySelector('small');

          Array.from(
            element.childNodes
          ).forEach(node => {

            if (node.nodeType === 3) {

              node.nodeValue =
                settings.business_name + ' ';

            }

          });

          if (
            small &&
            settings.business_tagline
          ) {

            small.textContent =
              settings.business_tagline;

          }

        });

    }


    /* ----------------------------------------------------------
       FOOTER BRAND / LOCATION
       ---------------------------------------------------------- */

    if (settings.location) {

      $$('.footer .brand span:not(.brand-mark) small')
        .forEach(element => {

          element.textContent =
            settings.location;

        });

    }


    /* ----------------------------------------------------------
       PHONE LINKS
       ---------------------------------------------------------- */

    if (settings.phone) {

      const phone =
        String(settings.phone)
          .replace(/[^0-9+]/g, '');

      $$('.footer a[href^="tel:"]')
        .forEach(element => {

          element.href =
            'tel:' + phone;

          element.textContent =
            settings.phone;

        });

    }


    /* ----------------------------------------------------------
       WHATSAPP LINKS
       ---------------------------------------------------------- */

    $$('.footer a[href*="wa.me/"]')
      .forEach(element => {

        if (settings.whatsapp_link) {

          element.href =
            settings.whatsapp_link;

        }

        if (settings.whatsapp) {

          element.textContent =
            'WhatsApp: ' +
            settings.whatsapp;

        }

      });


    /* ----------------------------------------------------------
       FOOTER CONTACT / LOCATION LINKS
       ---------------------------------------------------------- */

    if (settings.location) {

      $$('.footer a[href="contact.html"]')
        .forEach(element => {

          element.textContent =
            settings.location;

        });

    }


    /* ----------------------------------------------------------
       SOCIAL MEDIA

       Empty links are hidden.
       Existing HTML icons are preserved.
       ---------------------------------------------------------- */

    const socialKeys = [
      'facebook',
      'instagram',
      'youtube'
    ];

    $$('.footer .socials a')
      .forEach((element, index) => {

        const setting =
          socialKeys[index];

        if (!setting) {
          return;
        }

        if (settings[setting]) {

          element.href =
            settings[setting];

          element.hidden = false;

        } else {

          element.hidden = true;

        }

      });

  }


  /* Load centralized settings without
     preventing the rest of the website from loading. */

  loadSiteSettings();


  /* ------------------------------------------------------------
     CONTACT FORM
     ------------------------------------------------------------ */

  const contact =
    $('[data-contact-form]');

  if (contact) {

    contact.addEventListener(
      'submit',
      event => {

        event.preventDefault();

        const formData =
          new FormData(contact);

        const whatsapp =
          siteSettings.whatsapp_number ||
          siteSettings.whatsapp ||
          C.WHATSAPP ||
          '256709763803';

        const text =
`Kiteezi website enquiry
Name: ${formData.get('name') || ''}
Phone: ${formData.get('phone') || ''}
Email: ${formData.get('email') || ''}
Message: ${formData.get('message') || ''}`;

        const box =
          $('[data-form-message]', contact);

        if (box) {

          box.textContent =
            'Opening WhatsApp to send your enquiry to Kiteezi reception.';

          box.hidden = false;

        }

        window.open(
          'https://wa.me/' +
          String(whatsapp)
            .replace(/[^0-9]/g, '') +
          '?text=' +
          encodeURIComponent(text),
          '_blank'
        );

      }
    );

  }


  /* ------------------------------------------------------------
     BOOKING FORM
     ------------------------------------------------------------ */

  const bookingForm =
    $('[data-booking-form]');

  if (bookingForm) {
    initBooking(bookingForm);
  }


  async function initBooking(form) {

    const serviceSelect =
      $('[name="service"]', form);

    const foodBox =
      $('[data-catering]', form);

    const menuBox =
      $('[data-menu-options]', form);

    const totalBox =
      $('[data-food-total]', form);

    const payBox =
      $('[data-payment]', form);


    if (!serviceSelect) {
      return;
    }


    /* ----------------------------------------------------------
       REQUESTED SERVICE FROM URL
       ---------------------------------------------------------- */

    const params =
      new URLSearchParams(
        location.search
      );

    const requested =
      params.get('service');


    const known = {

      'school-swimming':
        'School Swimming',

      'training':
        'Swimming Training',

      'event':
        'Event & Catering',

      'basketball':
        'Basketball',

      'football':
        'Football'

    };


    /* ----------------------------------------------------------
       LOAD SERVICES
       ---------------------------------------------------------- */

    try {

      const services =
        await api(
          'services?select=id,name,category,description,price,duration_minutes&active=eq.true&order=category,name'
        );


      if (
        Array.isArray(services) &&
        services.length
      ) {

        const existing =
          services.map(
            service =>
              String(service.name)
                .toLowerCase()
          );


        /*
         * Keep the existing virtual sports
         * fallback for installations where
         * Basketball / Football are not yet
         * stored in services.
         */

        const extra = [

          {
            id: 'virtual-basketball',
            name: 'Basketball',
            category: 'sports',
            price: 0
          },

          {
            id: 'virtual-football',
            name: 'Football',
            category: 'sports',
            price: 0
          }

        ].filter(service =>
          !existing.includes(
            service.name.toLowerCase()
          )
        );


        const allServices =
          services.concat(extra);


        serviceSelect.innerHTML =
          all
