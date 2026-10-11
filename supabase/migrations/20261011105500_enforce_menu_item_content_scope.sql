-- Enforce field-level separation between public menu content and operational menu data.
-- RLS policies are permissive (OR-combined), so a content-management policy alone
-- cannot safely limit which columns a caller changes. This trigger provides that guard.

create or replace function private.enforce_menu_item_content_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if private.is_owner() then
    return new;
  end if;

  if private.has_permission('menu.manage')
     and private.menu_station_allowed(old.station_id)
     and private.menu_station_allowed(new.station_id) then
    return new;
  end if;

  if private.has_permission('menu.public_content.manage') then
    if new.price is distinct from old.price
       or new.requires_sides is distinct from old.requires_sides
       or new.in_stock is distinct from old.in_stock
       or new.price_on_request is distinct from old.price_on_request
       or new.station_id is distinct from old.station_id
       or new.serving_unit is distinct from old.serving_unit
       or new.inventory_tracked is distinct from old.inventory_tracked then
      raise exception 'You may edit menu names, descriptions, categories and images, but operational menu settings require the appropriate station permission.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'You do not have permission to update this menu item.'
    using errcode = '42501';
end
$function$;

drop trigger if exists trg_enforce_menu_item_content_scope on public.menu_items;
create trigger trg_enforce_menu_item_content_scope
before update on public.menu_items
for each row execute function private.enforce_menu_item_content_scope();
