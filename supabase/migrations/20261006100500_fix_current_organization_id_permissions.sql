-- Kiteezi: restore authenticated access to current_organization_id().
-- RLS policies for organizations/reporting call this helper. It is security
-- definer, so authenticated staff can safely execute it without direct table access.

revoke all on function public.current_organization_id() from public, anon;
grant execute on function public.current_organization_id() to authenticated, service_role;
