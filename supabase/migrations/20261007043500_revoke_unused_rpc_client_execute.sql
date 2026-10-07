-- Remove client execution from RPCs that are not browser-facing.
revoke execute on function public.kiteezi_push_notification_webhook() from anon, authenticated;
revoke execute on function public.get_public_bookings_by_phone(text) from authenticated;
revoke execute on function public.get_public_menu_admin() from authenticated;
revoke execute on function public.get_public_menu_admin_item(uuid) from authenticated;
