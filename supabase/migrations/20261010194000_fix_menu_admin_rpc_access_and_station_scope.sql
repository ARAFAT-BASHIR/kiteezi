-- Keep the menu editor's RPC grants aligned with its authenticated admin callers.
-- Station-limited menu staff must only receive items from their own station.
create or replace function public.get_public_menu_admin()
returns table(
  id uuid,
  category_id uuid,
  name text,
  description text,
  img_url text,
  alt_text text
)
language sql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
  select mi.id, mi.category_id, mi.name, mi.description, mi.img_url, mi.alt_text
  from public.menu_items mi
  where private.is_owner()
     or private.has_permission('menu.public_content.manage')
     or (
       private.has_permission('menu.manage')
       and private.menu_station_allowed(mi.station_id)
     )
  order by mi.name;
$function$;

create or replace function public.get_public_menu_admin_item(p_id uuid)
returns table(
  id uuid,
  category_id uuid,
  name text,
  description text,
  img_url text,
  alt_text text
)
language sql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
  select mi.id, mi.category_id, mi.name, mi.description, mi.img_url, mi.alt_text
  from public.menu_items mi
  where mi.id = p_id
    and (
      private.is_owner()
      or private.has_permission('menu.public_content.manage')
      or (
        private.has_permission('menu.manage')
        and private.menu_station_allowed(mi.station_id)
      )
    );
$function$;

revoke all on function public.get_public_menu_admin() from public, anon;
revoke all on function public.get_public_menu_admin_item(uuid) from public, anon;
grant execute on function public.get_public_menu_admin() to authenticated;
grant execute on function public.get_public_menu_admin_item(uuid) to authenticated;
