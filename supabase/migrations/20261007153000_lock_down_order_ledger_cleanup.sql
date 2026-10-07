-- The order-ledger cleanup function is trigger-only. It must not be callable through PostgREST.
revoke execute on function public.cleanup_order_ledger_on_delete() from public, anon, authenticated;
grant execute on function public.cleanup_order_ledger_on_delete() to postgres, service_role;
