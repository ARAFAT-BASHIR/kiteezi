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

  const SETTINGS_CACHE_KEY = 'kiteezi_public_settings_v1';
  const SETTINGS_CACHE_TTL = 60000;

  async function getSettings() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(SETTINGS_CACHE_KEY) || 'null');
      if (cached && Number(cached.savedAt) + SETTINGS_CACHE_TTL > Date.now() && cached.value && typeof cached.value === 'object') {
        return cached.value;
      }
    } catch {}

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
    const value = Object.fromEntries(
      (Array.isArray(rows) ? rows : []).map(row => [
        String(row.key),
        row.value ?? ''
      ])
    );

    try {
      sessionStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        value
      }));
    } catch {}

    return value;
  }

  // Only allow URLs that are safe for browser navigation/resource loading.
  // CMS values are data, not executable code. Keep relative paths and web URLs;
  // reject javascript:, data:, vbscript:, and other active schemes.
  function safeUrl(value, {allowRelative = true} = {}) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    if (allowRelative && /^(?:\/|\.\/|\.\.\/|[^:?#]+(?:[?#].*)?$)/.test(raw) && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw;
    try {
      const parsed = new URL(raw, location.href);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
    } catch {}
    return '';
  }

  function safeMail(value) {
    const email = String(value ?? '').trim().replace(/^mailto:/i, '');
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
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
          'a[href*="wa.me/"], [data-site-setting="whatsapp"], a[data-site-setting="whatsapp_link"], a[data-site-whatsapp-link], a[data-social="whatsapp"]'
        )
        .forEach(element => {
          if (element.matches('a')) {
            element.href = whatsappLink;
            element.target = '_blank';
            element.rel = 'noopener';
            element.setAttribute('aria-label', 'WhatsApp');
            element.title = 'WhatsApp';
          }

          /* Never expose the wa.me URL as visible public text. */
          if (element.dataset.social === 'whatsapp' || element.classList.contains('whatsapp-icon')) {
            element.innerHTML = '<i class="fa-brands fa-whatsapp" aria-hidden="true"></i>';
          } else {
            element.textContent = whatsappNumber || cleanWhatsApp(settings.whatsapp);
          }
        });
    }

    /*
      DATABASE-DRIVEN LINK TARGETS
    */
    document
      .querySelectorAll('[data-site-setting-href]')
      .forEach(element => {
        const setting = element.dataset.siteSettingHref;
        const value = String(settings[setting] ?? '').trim();
        if (!value) return;
        if (setting.endsWith('_email')) {
          const email = safeMail(value);
          element.href = email ? 'mailto:' + email : '#';
        } else if (setting === 'phone_link' || setting === 'phone') {
          const phone = cleanPhone(value);
          element.href = phone ? 'tel:' + phone : '#';
        } else {
          element.href = safeUrl(value) || '#';
        }
        if (setting === 'location_url') {
          element.target = '_blank';
          element.rel = 'noopener noreferrer';
        }
      });

    /*
      SOCIAL MEDIA
    */
    const socialMap = {
      facebook: safeUrl(settings.facebook, {allowRelative: false}),
      instagram: safeUrl(settings.instagram, {allowRelative: false}),
      youtube: safeUrl(settings.youtube || settings.youtube_link, {allowRelative: false}),
      whatsapp: safeUrl(whatsappLink, {allowRelative: false}),
      tiktok: safeUrl(settings.tiktok || settings.tiktok_link, {allowRelative: false}),
      x: safeUrl(settings.x || settings.twitter_link, {allowRelative: false}),
      twitter: safeUrl(settings.twitter || settings.x || settings.twitter_link, {allowRelative: false})
    };

    document.querySelectorAll('[data-social]').forEach(element => {
      const name = String(element.dataset.social || '').toLowerCase();
      const link = socialMap[name] || (name === 'twitter' ? socialMap.x : '');
      if (link) {
        element.href = link;
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
        element.hidden = false;
      } else {
        element.hidden = true;
      }
    });

    /*
      EMAIL CONTACTS
    */
    const infoEmail = String(settings.information_email || '').trim();
    const bookingsEmail = String(settings.bookings_email || '').trim();
    const businessEmail = String(settings.business_email || '').trim();
    document.querySelectorAll('[data-site-setting="information_email"]').forEach(element => {
      element.textContent = infoEmail;
      if (element.matches('a')) { const email = safeMail(infoEmail); element.href = email ? 'mailto:' + email : '#'; }
      element.hidden = !infoEmail;
    });
    document.querySelectorAll('[data-site-setting="bookings_email"]').forEach(element => {
      element.textContent = bookingsEmail;
      if (element.matches('a')) { const email = safeMail(bookingsEmail); element.href = email ? 'mailto:' + email : '#'; }
      element.hidden = !bookingsEmail;
    });
    document.querySelectorAll('[data-site-setting="business_email"]').forEach(element => {
      element.textContent = businessEmail;
      if (element.matches('a')) { const email = safeMail(businessEmail); element.href = email ? 'mailto:' + email : '#'; }
      element.hidden = !businessEmail;
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
      LOGO
      The logo is stored as a site setting so the owner can change it
      without editing the public pages. Relative paths are resolved from
      the public site root.
    */
    if (settings.logo_url) {
      document
        .querySelectorAll('.brand-mark')
        .forEach(element => {
          const img = document.createElement('img');
          const logoUrl = safeUrl(settings.logo_url);
          if (!logoUrl) return;
          img.src = logoUrl;
          img.alt = settings.business_name || 'Kiteezi Recreational Center';
          img.loading = 'eager';
          img.decoding = 'async';
          element.textContent = '';
          element.appendChild(img);
          element.setAttribute('aria-hidden', 'true');
        });
    }

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
      const mediaUrl = safeUrl(row.url);
      if (!mediaUrl) return;
      element.src = mediaUrl;
      if (row.alt_text) element.alt = row.alt_text;
    });
    const hero = document.querySelector('[data-media-hero]');
    if (hero && media[0]) {
      const heroUrl = safeUrl(media[0].url);
      if (heroUrl) hero.style.backgroundImage = 'linear-gradient(rgba(20,35,27,.64),rgba(20,35,27,.64)),url("' + heroUrl.replace(/["\\)]/g, '\\      hero.style.backgroundImage = 'linear-gradient(rgba(20,35,27,.64),rgba(20,35,27,.64)),url("' + media[0].url.replace(/"/g,'&quot;') + '")';') + '")';
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

  function ensureTeamProfileModal() {
    let modal = document.getElementById('public-team-profile-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'public-team-profile-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="team-profile-backdrop" data-team-modal-close></div>
      <div class="team-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="team-profile-title">
        <button type="button" class="team-profile-close" data-team-modal-close aria-label="Close profile">×</button>
        <div class="team-profile-photo-wrap"><img class="team-profile-photo" id="team-profile-photo" alt=""></div>
        <div class="eyebrow" id="team-profile-position"></div>
        <h2 id="team-profile-title"></h2>
        <p class="team-profile-description" id="team-profile-description"></p>
      </div>`;
    document.body.appendChild(modal);
    const close = () => {
      modal.hidden = true;
      document.body.classList.remove('team-profile-open');
    };
    modal.querySelectorAll('[data-team-modal-close]').forEach(button => button.addEventListener('click', close));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.hidden) close();
    });
    return modal;
  }

  function openTeamProfile(row) {
    const modal = ensureTeamProfileModal();
    const photo = modal.querySelector('#team-profile-photo');
    const position = modal.querySelector('#team-profile-position');
    const title = modal.querySelector('#team-profile-title');
    const description = modal.querySelector('#team-profile-description');
    const name = String(row.person_name || 'Kiteezi team member');
    const role = String(row.position || '');
    const department = String(row.department || '');
    const image = safeUrl(row.public_avatar_url) || '';

    title.textContent = name;
    position.textContent = [department, role].filter(Boolean).join(' • ');
    description.textContent = String(row.public_description || '').trim() || 'Profile description coming soon.';
    photo.src = image || '';
    photo.alt = name;
    photo.hidden = !image;
    modal.hidden = false;
    document.body.classList.add('team-profile-open');
  }

  async function applyTeamPositions() {
    const response = await fetch(url + '/rest/v1/team_positions?select=department,position,person_name,sort_order,active,public_avatar_url,public_description&active=eq.true&order=sort_order.asc', { headers });
    if (!response.ok) throw new Error('Could not load team positions.');
    const rows = await response.json();
    document.querySelectorAll('#public-team-positions').forEach(container => {
      const icons = ['GM','R','SC','FC','BD','GG','P'];
      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
      }[char]));
      container.innerHTML = rows.map((row, i) => {
        const name = escapeHtml(row.person_name || 'Kiteezi team member');
        const role = escapeHtml(row.position || '');
        const image = safeUrl(row.public_avatar_url) || '';
        const photo = image
          ? '<img class="team-card-photo" src="' + escapeHtml(image) + '" alt="' + name + '" loading="lazy">'
          : '<div class="team-card-placeholder">' + icons[i % icons.length] + '</div>';
        return '<article class="card team-profile-card" tabindex="0" role="button" aria-label="View profile of ' + name + '" data-team-profile-index="' + i + '">' +
          '<div class="card-body">' + photo +
          '<div class="eyebrow">' + role + '</div>' +
          '<h3>' + name + '</h3>' +
          '</div></article>';
      }).join('');

      container.querySelectorAll('[data-team-profile-index]').forEach(card => {
        const row = rows[Number(card.dataset.teamProfileIndex)];
        const open = () => openTeamProfile(row);
        card.addEventListener('click', open);
        card.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
          }
        });
      });
      container.hidden = rows.length === 0;
    });
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


  function socialIcon(platform) {
    const name = String(platform || '').trim().toLowerCase();
    const classes = {
      facebook: 'fa-brands fa-facebook-f',
      instagram: 'fa-brands fa-instagram',
      youtube: 'fa-brands fa-youtube',
      whatsapp: 'fa-brands fa-whatsapp',
      tiktok: 'fa-brands fa-tiktok',
      x: 'fa-brands fa-x-twitter',
      twitter: 'fa-brands fa-x-twitter'
    };
    return classes[name] || 'fa-brands fa-globe';
  }

  async function applySocialLinks() {
    const response = await fetch(
      url + '/rest/v1/social_links?select=platform,label,url,icon,sort_order&active=eq.true&order=sort_order.asc',
      { headers }
    );
    if (!response.ok) throw new Error('Could not load social links.');

    const rows = await response.json();
    const byPlatform = {};
    (Array.isArray(rows) ? rows : []).forEach(row => {
      byPlatform[String(row.platform || '').trim().toLowerCase()] = row;
    });

    document.querySelectorAll('[data-social]').forEach(element => {
      const requested = String(element.dataset.social || '').trim().toLowerCase();
      const keys = requested === 'twitter' ? ['twitter', 'x'] : [requested];
      const row = keys.map(key => byPlatform[key]).find(Boolean);

      if (!row || !row.url) {
        element.hidden = true;
        return;
      }

      element.hidden = false;
      element.href = safeUrl(row.url, {allowRelative: false}) || '#';
      element.target = '_blank';
      element.rel = 'noopener noreferrer';
      element.setAttribute('aria-label', row.label || requested);
      element.title = row.label || requested;
      element.innerHTML = '<i class="' + socialIcon(row.platform) + '" aria-hidden="true"></i>';
    });

    document.querySelectorAll('[data-social-links]').forEach(container => {
      container.innerHTML = (Array.isArray(rows) ? rows : []).map(row => {
        const label = String(row.label || row.platform || '');
        const href = (safeUrl(row.url, {allowRelative: false}) || '#').replace(/"/g, '&quot;');
        return '<a class="social-link" href="' + href + '" target="_blank" rel="noopener noreferrer" aria-label="' +
          label.replace(/"/g, '&quot;') + '" title="' + label.replace(/"/g, '&quot;') +
          '"><i class="' + socialIcon(row.platform) + '" aria-hidden="true"></i></a>';
      }).join('');
      container.hidden = rows.length === 0;
    });
  }

  window.KiteeziContent = {
    settings: null,

    getSettings,

    refresh: async function () {
      /*
        Start independent reads together. Only load page-specific data when
        the current page actually has elements that use it.
      */
      const needsTeam = !!document.querySelector('#public-team-positions');
      const needsServices = !!document.querySelector('[data-db-service-price]');
      const needsMedia = !!document.querySelector('[data-media-index], [data-media-hero]');
      const needsCms = !!document.querySelector('.hero, [data-cms-field], meta[name="description"]');
      const needsSocial = !!document.querySelector('[data-social], [data-social-links]');

      const settingsPromise = getSettings();
      const teamPromise = needsTeam
        ? applyTeamPositions().catch(error => console.warn('Team positions unavailable:', error))
        : Promise.resolve();
      const servicesPromise = needsServices
        ? applyServicePrices().catch(error => console.warn('Service prices unavailable:', error))
        : Promise.resolve();
      const mediaPromise = needsMedia
        ? applyMedia().catch(error => console.warn('Page media unavailable:', error))
        : Promise.resolve();
      const cmsPromise = needsCms
        ? applyCmsPage().catch(error => console.warn('Page content unavailable:', error))
        : Promise.resolve();
      const socialPromise = needsSocial
        ? applySocialLinks().catch(error => console.warn('Social links unavailable:', error))
        : Promise.resolve();

      const settings = await settingsPromise;
      window.KiteeziContent.settings = settings;
      applySettings(settings);

      await Promise.all([
        teamPromise,
        servicesPromise,
        mediaPromise,
        cmsPromise,
        socialPromise
      ]);

      return settings;
    },

    applySettings
  };

})();
