-- Ensure every active staff role can read the role/permission catalog used by
-- the admin UI. Previously head_chef (and several other valid roles) was omitted,
-- causing its permission query to be blocked by RLS and leaving only Settings visible.

create or replace function private.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.name = p.role
    where p.id = (select auth.uid())
      and p.active = true
  );
$function$;
