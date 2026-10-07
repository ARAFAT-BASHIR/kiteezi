-- Restrict menu visibility and editing to the operational station assigned to each role.
create or replace function private.menu_station_allowed(p_station_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.service_stations ss on ss.id = p_station_id
    where p.id = (select auth.uid())
      and p.active = true
      and (
        p.role = 'owner'
        or (p.role in ('chef','head_chef') and lower(ss.name) = 'kitchen')
        or (p.role = 'barista' and lower(ss.name) = 'barista')
      )
  );
$$;

drop policy if exists "Public can read in-stock menu items" on public.menu_items;
drop policy if exists "Staff manage menu items by permission" on public.menu_items;

create policy "Public can read in-stock menu items"
on public.menu_items
for select
to anon
using (coalesce(in_stock, true) = true);

create policy "Authenticated staff read menu items by station"
on public.menu_items
for select
to authenticated
using (
  private.is_owner()
  or private.has_permission('menu.public_content.manage'::text)
  or (
    (private.has_permission('menu.view'::text) or private.has_permission('menu.manage'::text))
    and private.menu_station_allowed(station_id)
  )
);

create policy "Staff manage menu items by station and permission"
on public.menu_items
for all
to authenticated
using (
  private.has_permission('menu.manage'::text)
  and private.menu_station_allowed(station_id)
)
with check (
  private.has_permission('menu.manage'::text)
  and private.menu_station_allowed(station_id)
);
