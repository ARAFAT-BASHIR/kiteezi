(function () {
  'use strict';

  /*
   * ============================================================
   * KITEEZI PUBLIC WEBSITE CORE
   * ============================================================
   *
   * This file is the shared public-site application layer.
   *
   * Responsibilities:
   *   - Supabase REST connection
   *   - Site settings
   *   - Public navigation
   *   - Mobile navigation
   *   - Shopping cart
   *   - Menu/database integration
   *   - Order preparation
   *   - Existing-page compatibility
   *
   * IMPORTANT:
   *   - Never use a Supabase service-role key here.
   *   - The public website stays separate from admin.
   *   - Database data is preferred over hard-coded fallback data.
   *   - The cart is stored locally until checkout.
   */

  const C = window.KITEEZI_CONFIG || {};

  const SUPABASE_URL = String(
    C.SUPABASE_URL || ''
  ).replace(/\/+$/, '');

  const SUPABASE_KEY =
    C.SUPABASE_ANON_KEY || '';

  const CART_KEY =
    'kiteezi_cart_v2';

  const money = value =>
    new Intl.NumberFormat('en-UG').format(
      Math.max(0, Number(value) || 0)
    );

  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[character])
    );

  const $ = (
    selector,
    root = document
  ) => root.querySelector(selector);

  const $$ = (
    selector,
    root = document
  ) => Array.from(
    root.querySelectorAll
