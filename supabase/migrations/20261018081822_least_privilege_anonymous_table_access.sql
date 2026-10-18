REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;

GRANT SELECT ON TABLE
  public.announcements,
  public.booking_bundle_items,
  public.booking_bundles,
  public.cms_pages,
  public.gallery_items,
  public.media,
  public.menu_categories,
  public.menu_items,
  public.reviews,
  public.service_stations,
  public.services,
  public.site_settings,
  public.social_links,
  public.sports,
  public.swimming_timetable,
  public.team_positions
TO anon;

GRANT INSERT ON TABLE
  public.gallery_items,
  public.inquiries,
  public.reviews
TO anon;
