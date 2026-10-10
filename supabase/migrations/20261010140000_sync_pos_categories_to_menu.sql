-- Kiteezi: align order-entry POS categories with the current public menu.
-- Menu-linked POS items should appear under the same category customers see.
-- Preserve operational-only items (buffet/events, sports, swimming) and their history.
begin;

update public.menu_categories
set name = 'Salads & Desserts'
where name = 'Salads / Deserts';

insert into public.pos_categories (name, description, sort_order, active, created_at, updated_at)
select mc.name, 'Items from the public menu category: ' || mc.name, mc.sort_order, mc.active, now(), now()
from public.menu_categories mc
on conflict (name) do update
set sort_order = excluded.sort_order,
    active = excluded.active,
    updated_at = now();

update public.pos_items pi
set category_id = pc.id,
    updated_at = now()
from public.menu_items mi
join public.menu_categories mc on mc.id = mi.category_id
join public.pos_categories pc on pc.name = mc.name
where pi.menu_item_id = mi.id
  and pi.category_id <> pc.id;

-- Retire generic/unused categories rather than deleting records.
update public.pos_categories pc
set active = false, updated_at = now()
where pc.name in ('Food', 'Drinks', 'Photography')
  and not exists (
    select 1 from public.pos_items pi
    where pi.category_id = pc.id and pi.active = true
  );

-- Never infer preparation completion from a display category name.
create or replace function private.initialize_order_station_progress(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
begin
  insert into public.order_station_progress(order_id, station_id, status)
  select oi.order_id, mi.station_id, 'waiting'
  from public.order_items oi
  join public.menu_items mi on mi.id = oi.menu_item_id
  join public.service_stations ss on ss.id = mi.station_id and ss.active
  where oi.order_id = p_order_id
    and mi.station_id is not null
  group by oi.order_id, mi.station_id
  on conflict (order_id, station_id) do nothing;
end;
$function$;

revoke all on function private.initialize_order_station_progress(uuid) from public, anon, authenticated;

commit;
