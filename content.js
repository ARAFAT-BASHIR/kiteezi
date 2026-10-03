/* ============================================================
   KITEEZI PUBLIC CONTENT
   Database-backed settings with safe HTML fallbacks.
   ============================================================ */

(function () {
  'use strict';

  const C = window.KITEEZI_CONFIG || {};
  const url = String(C.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(C.SUPABASE_ANON_KEY || '');

  if (!url || !key) {
    console.warn('Kiteezi Supabase configuration is missing.');
    return;
  }

  const headers = {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  };

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
        'Could not load site settings. HTTP ' + response.status
      );
    }

    const rows = await response.json();

    return Object.fromEntries(
      (Array.isArray(rows) ? rows : []).map(row => [
        String(row.key),
        row.value ?? ''
      ])
    );
  }

  function cleanPhone(value) {
    return String(value || '').replace(/[^0-9+]/g, '');
  }

  function cleanWhatsApp(value) {
    return String(value || '')
      .replace(/^https?:\/\/wa\.me\//i, '')
      .replace(/[^0-9]/g, '');
  }

  function setText(selector, value) {
    if (value === undefined || value === null || value === '') return;

    document.querySelectorAll(selector).forEach(element => {
      element.textContent = String(value);
    });
  }

  function applySettings(settings) {
    /*
      Generic database settings.
    */
    document
      .querySelectorAll('[data-site-setting]')
      .forEach(element => {
        const setting = element.dataset.siteSetting;

        if (!(setting in settings)) return;

        const value = settings[setting] ?? '';

        if (
          element.matches('input, textarea, select')
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

    /*
      BUSINESS NAME
    */
    if (settings.business_name) {
      document
        .querySelectorAll('.brand-name')
        .forEach(element => {
          element.textContent = settings.business_name;
        });

      document.title =
        settings.business_name +
        ' | ' +
        (settings.business_tagline ||
          'Comfort • Dining • Recreation');
    }

    /*
      TAGLINE
    */
    if (settings.business_tagline) {
      document
        .querySelectorAll(
          '[data-site-setting="business_tagline"]'
        )
        .forEach(element => {
          element.textContent =
            settings.business_tagline;
        });
    }

    /*
      LOCATION
    */
    if (settings.location) {
      setText(
        '[data-site-setting="location"]',
        settings.location
      );
    }

    /*
      PHONE
    */
    if (settings.phone) {
      const phone = settings.phone;
      const phoneLink =
        settings.phone_link ||
        'tel:' + cleanPhone(phone);

      document
        .querySelectorAll(
          '[data-site-setting="phone"]'
        )
        .forEach(element => {
          element.textContent = phone;

          if (
            element.matches('a')
          ) {
            element.href = phoneLink;
          }
        });

      document
        .querySelectorAll(
          'a[href^="tel:"]'
        )
        .forEach(element => {
          element.href = phoneLink;

          if (
            element.dataset.siteSetting === 'phone' ||
            element.closest('.topbar') ||
            element.closest('.footer')
          ) {
            element.textContent = phone;
          }
        });
    }

    /*
      WHATSAPP
    */
    const whatsappNumber =
      settings.whatsapp_number ||
      cleanWhatsApp(settings.whatsapp);

    const whatsappLink =
      settings.whatsapp_link ||
      (
        whatsappNumber
          ? 'https://wa.me/' + whatsappNumber
          : ''
      );

    if (whatsappLink) {
      document
        .querySelectorAll(
          'a[href*="wa.me/"], [data-site-setting="whatsapp"]'
        )
        .forEach(element => {
          if (element.matches('a')) {
            element.href = whatsappLink;
          }

          if (
            element.dataset.siteSetting === 'whatsapp' &&
            settings.whatsapp
          ) {
            element.textContent =
              settings.whatsapp;
          }
        });
    }

    /*
      SOCIAL MEDIA
    */
    const socialMap = {
      facebook: settings.facebook,
      instagram: settings.instagram,
      youtube: settings.youtube,
      whatsapp: whatsappLink
    };

    document
      .querySelectorAll(
        '[data-social]'
      )
      .forEach(element => {
        const name = element.dataset.social;
        const link = socialMap[name];

        if (link) {
          element.href = link;
          element.hidden = false;
        } else {
          element.hidden = true;
        }
      });

    /*
      PAYMENT CONTACTS
    */
    setText(
      '[data-site-setting="airtel_money"]',
      settings.airtel_money
    );

    setText(
      '[data-site-setting="mtn_money"]',
      settings.mtn_money
    );

    /*
      COPYRIGHT
    */
    document
      .querySelectorAll('[data-year]')
      .forEach(element => {
        element.textContent =
          new Date().getFullYear();
      });
  }




  async function applyCmsPage() {
    const slug = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/i, '') || 'index';
    const response = await fetch(
      url + '/rest/v1/cms_pages?select=title,content,published&slug=eq.' + encodeURIComponent(slug) + '&published=eq.true&limit=1',
      { headers }
    );
    if (!response.ok) throw new Error('Could not load CMS page.');
    const rows = await response.json();
    const page = rows?.[0];
    if (!page) return;
    const content = page.content || {};
    const heroTitle = content.hero_title || content.hero?.title || page.title;
    const intro = content.intro || content.hero?.description || content.description;
    const hero = document.querySelector('.hero');
    const heading = hero?.querySelector('h1');
    const paragraph = hero?.querySelector('p');
    if (heading && heroTitle) heading.textContent = heroTitle;
    if (paragraph && intro) paragraph.textContent = intro;
    const meta = document.querySelector('meta[name="description"]');
    if (meta && content.meta_description) meta.content = content.meta_description;
    document.querySelectorAll('[data-cms-field]').forEach(element => {
      const key = element.dataset.cmsField;
      const value = content[key] ?? content.hero?.[key];
      if (value !== undefined && value !== null && typeof value !== 'object') element.textContent = String(value);
    });
  }

  async function getMedia(pageSlug) {
    const response = await fetch(
      url + '/rest/v1/media?select=page_slug,sort_order,url,alt_text,title,active&active=eq.true&page_slug=eq.' + encodeURIComponent(pageSlug) + '&order=sort_order.asc',
      { headers }
    );
    if (!response.ok) throw new Error('Could not load media.');
    return response.json();
  }

  async function applyMedia() {
    const pageSlug = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/i, '') || 'index';
    const media = await getMedia(pageSlug);
    document.querySelectorAll('[data-media-index]').forEach(element => {
      const row = media[Number(element.dataset.mediaIndex) - 1];
      if (!row) return;
      element.src = row.url;
      if (row.alt_text) element.alt = row.alt_text;
    });
    const hero = document.querySelector('[data-media-hero]');
    if (hero && media[0]) {
      hero.style.backgroundImage = 'linear-gradient(rgba(20,35,27,.64),rgba(20,35,27,.64)),url("' + media[0].url.replace(/"/g,'&quot;') + '")';
    }
  }

  async function getServices() {
    const response = await fetch(
      url + '/rest/v1/services?select=id,name,price,pricing_mode,team_threshold,small_group_price,full_team_price&active=eq.true',
      { headers }
    );
    if (!response.ok) throw new Error('Could not load services.');
    return response.json();
  }

  async function applyServicePrices() {
    const services = await getServices();
    const byName = Object.fromEntries(services.map(item => [String(item.name).toLowerCase(), item]));
    document.querySelectorAll('[data-db-service-price]').forEach(element => {
      const service = byName[String(element.dataset.dbServicePrice).toLowerCase()];
      if (!service) return;
      const price = Number(service.price);
      element.textContent = Number.isFinite(price) && price > 0
        ? 'UGX ' + new Intl.NumberFormat('en-UG').format(price)
        : 'Price on request';
    });
  }


  async function applySocialLinks() {
    const response = await fetch(url + '/rest/v1/social_links?select=platform,label,url,icon,sort_order&active=eq.true&order=sort_order.asc', { headers });
    if (!response.ok) throw new Error('Could not load social links.');
    const rows = await response.json();
    document.querySelectorAll('[data-social-links]').forEach(container => {
      container.innerHTML = rows.map(row => '<a href="' + String(row.url).replace(/"/g,'&quot;') + '" target="_blank" rel="noopener noreferrer" aria-label="' + String(row.label).replace(/"/g,'&quot;') + '">' + String(row.icon || row.label).replace(/[<>]/g,'') + '</a>').join('');
      container.hidden = rows.length === 0;
    });
  }

  window.KiteeziContent = {
    settings: null,

    getSettings,

    refresh: async function () {
      const settings = await getSettings();

      window.KiteeziContent.settings =
        settings;

      applySettings(settings);
      await applyServicePrices();
      await applyMedia();
      await applyCmsPage();
      await applySocialLinks();
      return settings;
    },

    applySettings
  };

  getSettings()
    .then(settings => {
      window.KiteeziContent.settings =
        settings;

      applySettings(settings);
      applyServicePrices().catch(error => console.warn('Service prices unavailable:', error));
      applyMedia().catch(error => console.warn('Media unavailable:', error));
      applyCmsPage().catch(error => console.warn('CMS unavailable:', error));
      applySocialLinks().catch(error => console.warn('Social links unavailable:', error));
    })
    .catch(error => {
      console.warn(
        'Kiteezi site settings unavailable. ' +
        'Existing website content remains active.',
        error
      );
    });

})();
