create or replace function public.set_order_item_shared_pool_components(
  p_order_item_id uuid,
  p_components jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare
  v_order_id uuid;
  v_menu_item_id uuid;
  v_status text;
  v_count integer;
  v_valid_count integer;
begin
  if not private.has_permission('orders.manage') then
    raise exception 'Not authorized to set order components' using errcode = '42501';
  end if;
  if p_order_item_id is null or jsonb_typeof(coalesce(p_components, '[]'::jsonb)) <> 'array' then
    raise exception 'Choose valid order components';
  end if;
  if jsonb_array_length(p_components) < 1 or jsonb_array_length(p_components) > 7 then
    raise exception 'Choose between 1 and 7 fruit components';
  end if;

  select oi.order_id, oi.menu_item_id, o.status
    into v_order_id, v_menu_item_id, v_status
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.id = p_order_item_id
  for update of oi, o;

  if not found then
    raise exception 'Order item not found';
  end if;
  if v_status not in ('pending', 'open') then
    raise exception 'Cocktail components can only be selected before the order is confirmed';
  end if;
  if not exists (
    select 1
    from public.shared_pool_menu_rules r
    where r.menu_item_id = v_menu_item_id
      and r.requires_components = true
      and r.active = true
  ) then
    raise exception 'This order item does not require fruit selection';
  end if;

  select count(distinct (x.value->>'inventory_item_id')::uuid),
         count(*)
    into v_count, v_valid_count
  from jsonb_array_elements(p_components) x(value)
  where x.value ? 'inventory_item_id'
    and lower(coalesce(x.value->>'dish_type','')) = 'cocktail_component';

  if v_valid_count <> jsonb_array_length(p_components)
     or v_count <> jsonb_array_length(p_components) then
    raise exception 'Choose unique, valid fruit components';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_components) x(value)
    left join public.inventory_items i
      on i.id = (x.value->>'inventory_item_id')::uuid
    where i.id is null
      or i.active is distinct from true
      or lower(trim(i.name)) not in (
        'orange','lemon','pineapple','passion fruit','beetroot','watermelon','mango'
      )
  ) then
    raise exception 'One or more selected fruit items are unavailable';
  end if;

  update public.order_items
  set shared_pool_components = p_components
  where id = p_order_item_id;

  return true;
end;
$function$;

revoke all on function public.set_order_item_shared_pool_components(uuid,jsonb) from public, anon;
grant execute on function public.set_order_item_shared_pool_components(uuid,jsonb) to authenticated, service_role;

drop policy if exists "Full order managers" on public.order_items;
create policy "Order managers can read all order items"
on public.order_items
for select
to authenticated
using (private.has_permission('orders.manage'));
