revoke all on function public.finalize_order_inventory(uuid) from public, anon, authenticated;
grant execute on function public.finalize_order_inventory(uuid) to service_role;
