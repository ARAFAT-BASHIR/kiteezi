-- Hide the owner from every non-owner staff view while preserving owner-only management.
create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select organization_id
  from public.profiles
  where id = (select auth.uid())
    and active = true
  limit 1;
$function$;

revoke all on function private.current_organization_id() from public;
grant execute on function private.current_organization_id() to authenticated;

drop policy if exists "Authenticated users can read their own Kiteezi profile" on public.profiles;

create policy "Staff can read non-owner profiles in their organization"
on public.profiles
for select
to authenticated
using (
  private.is_owner()
  or (
    role <> 'owner'
    and organization_id = private.current_organization_id()
  )
);
