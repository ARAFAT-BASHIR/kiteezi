/* ============================================================
   KITEEZI PUBLIC CONTENT FOUNDATION
   ============================================================

   Loads business/contact/social settings from Supabase.

   IMPORTANT:
   Existing hard-coded website content remains in the HTML.
   If the database is unavailable, the existing website content
   continues to display.

   This means Phase 1 does not destroy the current design/content.
   ============================================================ */

(function () {

  const C = window.KITEEZI_CONFIG || {};

  const url = (C.SUPABASE_URL || '').replace(/\/$/, '');
  const key = C.SUPABASE_ANON_KEY || '';

  if (!url || !key) {
    console.warn('Kiteezi Supabase configuration is missing.');
    return;
  }


  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  };


  /* ------------------------------------------------------------
     GET SITE SETTINGS
     ------------------------------------------------------------ */

  async function getSettings() {

    const response = await fetch(
      url + '/rest/v1/site_settings?select=key,value',
      {
        method: 'GET',
        headers
      }
    );

    if (!response.ok) {
      throw new Error(
        'Could not load Kiteezi site settings. HTTP ' +
        response.status
      );
    }

    const rows = await response.json();

    return Object.fromEntries(
      (rows || []).map(row => [
        row.key,
        row.value
      ])
    );
  }


  /* ------------------------------------------------------------
     APPLY SETTINGS TO PUBLIC WEBSITE
     ------------------------------------------------------------ */

  function applySettings(settings) {


    /*
      Generic:

      Any HTML element can use:

      data-site-setting="business_name"

      and its text will automatically be replaced.
    */

    document
      .querySelectorAll('[data-site-setting]')
      .forEach(element => {

        const setting = element.dataset.siteSetting;

        if (!(setting in settings)) {
          return;
        }

        const value = settings[setting] ?? '';

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

          element.textContent = value;

        }

      });


    /*
      TOP BAR
    */

    document
      .querySelectorAll(
        '.topbar .container span:first-child'
      )
      .forEach(element => {

        if (settings.location) {
          element.textContent = settings.location;
        }

      });


    document
      .querySelectorAll(
        '.topbar .container span:last-child'
      )
      .forEach(element => {

        if (settings.phone) {
          element.textContent =
            'Daily enquiries: ' +
            settings.phone;
        }

      });


    /*
      BRAND
    */

    document
      .querySelectorAll(
        '.brand span:not(.brand-mark)'
      )
      .forEach(element => {

        if (!settings.business_name) {
          return;
        }

        const small =
          element.querySelector('small');


        /*
          Preserve the existing brand markup.
        */

        Array.from(element.childNodes)
          .forEach(node => {

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


    /*
      FOOTER LOCATION
    */

    document
      .querySelectorAll(
        '.footer .brand span:not(.brand-mark) small'
      )
      .forEach(element => {

        if (settings.location) {
          element.textContent =
            settings.location;
        }

      });


    /*
      PHONE
    */

    document
      .querySelectorAll(
        '.footer a[href^="tel:"]'
      )
      .forEach(element => {

        if (!settings.phone) {
          return;
        }

        const number =
          settings.phone.replace(
            /[^0-9+]/g,
            ''
          );

        element.href =
          'tel:' + number;

        element.textContent =
          settings.phone;

      });


    /*
      WHATSAPP
    */

    document
      .querySelectorAll(
        '.footer a[href*="wa.me/"]'
      )
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


    /*
      FOOTER LOCATION LINK
    */

    document
      .querySelectorAll(
        '.footer a[href="contact.html"]'
      )
      .forEach(element => {

        if (settings.location) {

          element.textContent =
            settings.location;

        }

      });


    /*
      SOCIAL MEDIA

      The existing footer has:
      Facebook
      Instagram
      YouTube

      We connect those first.
    */

    const socialKeys = [
      'facebook',
      'instagram',
      'youtube'
    ];


    document
      .querySelectorAll(
        '.footer .socials a'
      )
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

          /*
            Hide an empty social button rather
            than leaving a dead "#".
          */

          element.hidden = true;

        }

      });

  }


  /* ------------------------------------------------------------
     PUBLIC API
     ------------------------------------------------------------ */

  window.KiteeziContent = {

    settings: null,

    getSettings,

    refresh: async function () {

      const settings =
        await getSettings();

      window.KiteeziContent.settings =
        settings;

      applySettings(settings);

      return settings;

    }

  };


  /* ------------------------------------------------------------
     INITIAL LOAD
     ------------------------------------------------------------ */

  getSettings()

    .then(settings => {

      window.KiteeziContent.settings =
        settings;

      applySettings(settings);

    })

    .catch(error => {

      /*
        Important fallback:
        Never break the existing website just because
        the settings table is unavailable.
      */

      console.warn(
        'Kiteezi site settings unavailable. ' +
        'Existing website content will remain visible.',
        error
      );

    });


})();
