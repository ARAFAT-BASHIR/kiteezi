create or replace function private.prevent_non_owner_owner_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
begin
  if old.role = 'owner' and not private.is_owner() then
    raise exception 'Owner accounts cannot be changed by this role' using errcode = '42501';
  end if;

  if old.role is distinct from new.role and not private.is_owner() then
    raise exception 'Only the owner can change staff access roles' using errcode = '42501';
  end if;

  return new;
end;
$function$;
