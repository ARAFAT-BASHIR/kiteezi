-- Correct cocktail allocation to the authoritative business rule.
-- 1 fruit = 1/4 glass; 2 fruits = 1/2 each; 3 fruits = 1/3 each.
-- Preserve all existing Admin fruit batch yields.

create or replace function public.finalize_order_inventory(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog', 'pg_temp'
as $function$
declare
  r record;
  recipe record;
  spr record;
  v_fraction numeric;
  v_component_count integer;
begin
  if not private.has_permission('orders.manage') then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.orders where id=p_order_id) then
    raise exception 'Order % does not exist', p_order_id;
  end if;

  for r in
    select oi.id, oi.menu_item_id, oi.qty, oi.shared_pool_profile,
           oi.shared_pool_fraction, oi.shared_pool_components, mi.name as menu_item_name
    from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id
    where oi.order_id=p_order_id order by oi.id
  loop
    if exists (select 1 from public.shared_pool_menu_rules where menu_item_id=r.menu_item_id and active) then
      if exists (select 1 from public.shared_pool_menu_rules
                 where menu_item_id=r.menu_item_id and active and requires_components) then
        if jsonb_typeof(r.shared_pool_components) <> 'array'
           or jsonb_array_length(r.shared_pool_components)=0 then
          raise exception 'Order item % (%): cocktail components are required before inventory can be finalized',
            r.id,r.menu_item_name;
        end if;

        select count(*) into v_component_count from jsonb_array_elements(r.shared_pool_components);
        if v_component_count < 1 or v_component_count > 3 then
          raise exception 'Order item % (%): cocktail requires 1 to 3 selected fruit bases',
            r.id,r.menu_item_name;
        end if;

        for spr in
          select (x->>'inventory_item_id')::uuid as inventory_item_id,
                 coalesce(x->>'dish_type','cocktail_component') as dish_type
          from jsonb_array_elements(r.shared_pool_components) x
        loop
          if not exists (
            select 1 from public.inventory_items i
            where i.id=spr.inventory_item_id
              and i.name in ('Orange','Lemon','Pineapple','Passion fruit','Beetroot','Watermelon','Mango')
              and i.active
          ) then
            raise exception 'Invalid cocktail fruit inventory item %',spr.inventory_item_id;
          end if;

          v_fraction := case
            when v_component_count = 1 then 0.25
            when v_component_count = 2 then 0.50
            when v_component_count = 3 then 1.0/3.0
          end;

          perform * from public.allocate_and_finalize_shared_pool(
            p_order_id,r.id,r.menu_item_id,spr.inventory_item_id,spr.dish_type,
            (r.qty::numeric * v_fraction),'cocktail');
        end loop;
      else
        for spr in
          select * from public.shared_pool_menu_rules
          where menu_item_id=r.menu_item_id and active and not requires_components
            and (allocation_profile is null or allocation_profile=r.shared_pool_profile)
        loop
          if spr.requires_profile and r.shared_pool_profile is null then
            raise exception 'Order item % (%): production profile is required before shared chicken stock can be allocated',
              r.id,r.menu_item_name;
          end if;
          if spr.fraction_per_menu_unit is null then
            if r.shared_pool_fraction is null then
              raise exception 'Order item % (%): explicit shared-pool fraction is required; the system will not guess',
                r.id,r.menu_item_name;
            end if;
            v_fraction:=r.shared_pool_fraction*r.qty;
          else
            v_fraction:=spr.fraction_per_menu_unit*r.qty;
          end if;
          perform * from public.allocate_and_finalize_shared_pool(
            p_order_id,r.id,r.menu_item_id,spr.inventory_item_id,spr.dish_type,v_fraction,
            coalesce(r.shared_pool_profile,spr.allocation_profile));
        end loop;
      end if;
    else
      if not exists (select 1 from public.menu_item_recipes mir where mir.menu_item_id=r.menu_item_id) then
        raise exception 'No inventory recipe or shared-pool rule exists for menu item "%". Inventory finalization refused to prevent silent stock drift.',
          r.menu_item_name;
      end if;
      for recipe in
        select mir.inventory_item_id,
               mir.quantity*coalesce(mir.stock_units_per_recipe_unit,1)*r.qty as qty
        from public.menu_item_recipes mir where mir.menu_item_id=r.menu_item_id
      loop
        insert into public.inventory_consumptions(order_id,order_item_id,inventory_item_id,quantity)
        values(p_order_id,r.id,recipe.inventory_item_id,recipe.qty)
        on conflict(order_item_id,inventory_item_id) do nothing;
        if found then
          insert into public.stock_movements(item_id,quantity,movement_type,reason,staff_id)
          values(recipe.inventory_item_id,recipe.qty,'out','Order '||p_order_id::text,auth.uid());
        end if;
      end loop;
    end if;
  end loop;
  return true;
end;
$function$;

revoke all on function public.finalize_order_inventory(uuid) from public;
grant execute on function public.finalize_order_inventory(uuid) to authenticated, service_role;
