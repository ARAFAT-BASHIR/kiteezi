-- Reconcile live Supabase shared-pool functions with GitHub source of truth.
-- Generated from the verified production definitions on 2026-10-05.
-- This closes the source-control gap left by the earlier marker migration.

create or replace function public.allocate_and_finalize_shared_pool(
  p_order_id uuid, p_order_item_id uuid, p_menu_item_id uuid,
  p_inventory_item_id uuid, p_dish_type text, p_requested_fraction numeric,
  p_allocation_profile text default null
)
returns table(allocation_id uuid, pool_id uuid, allocated_fraction numeric, consumed_quantity numeric)
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog'
as $function$
declare
  v_order_item public.order_items%rowtype;
  v_item public.inventory_items%rowtype;
  v_pool public.inventory_shared_pools%rowtype;
  v_need numeric := round(p_requested_fraction,8);
  v_take numeric;
  v_total_consumed numeric := 0;
  v_stock_balance numeric;
  v_pool_capacity numeric;
  v_unallocated_stock numeric;
  v_next_pool_number bigint;
  v_existing_consumption uuid;
begin
  if not private.has_permission('orders.manage') then raise exception 'Not authorized'; end if;
  if v_need is null or v_need <= 0 then raise exception 'Shared-pool allocation must be greater than zero'; end if;

  select * into v_order_item from public.order_items
  where id=p_order_item_id and order_id=p_order_id and menu_item_id=p_menu_item_id for update;
  if not found then raise exception 'Order item % does not belong to order %',p_order_item_id,p_order_id; end if;

  select * into v_item from public.inventory_items
  where id=p_inventory_item_id and active for update;
  if not found then raise exception 'Shared inventory item % is missing or inactive',p_inventory_item_id; end if;

  select ic.id into v_existing_consumption
  from public.inventory_consumptions ic
  where ic.order_item_id=p_order_item_id and ic.inventory_item_id=p_inventory_item_id limit 1;

  if v_existing_consumption is not null then
    return query
      select pa.id,pa.pool_id,pa.allocated_fraction,pa.consumed_quantity
      from public.pool_allocations pa
      where pa.order_item_id=p_order_item_id and pa.inventory_item_id=p_inventory_item_id
      order by pa.created_at,pa.id;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('shared-pool:'||p_inventory_item_id::text,0));

  loop
    select * into v_pool
    from public.inventory_shared_pools
    where inventory_item_id=p_inventory_item_id and status='active' and remaining_capacity > 0
    order by pool_number limit 1 for update;
    exit when not found;

    v_take:=least(v_need,v_pool.remaining_capacity);
    update public.inventory_shared_pools
    set remaining_capacity=round(remaining_capacity-v_take,8),
        status=case when remaining_capacity-v_take <= 0.00000001 then 'exhausted' else 'active' end,
        exhausted_at=case when remaining_capacity-v_take <= 0.00000001 then now() else exhausted_at end
    where id=v_pool.id;

    insert into public.pool_allocations(
      pool_id,order_id,order_item_id,menu_item_id,inventory_item_id,
      dish_type,allocation_profile,allocated_fraction,consumed_quantity,unit)
    values(v_pool.id,p_order_id,p_order_item_id,p_menu_item_id,p_inventory_item_id,
      p_dish_type,p_allocation_profile,v_take,v_take*v_pool.capacity,v_item.unit)
    returning id into allocation_id;

    pool_id:=v_pool.id;
    allocated_fraction:=v_take;
    consumed_quantity:=v_take*v_pool.capacity;
    v_total_consumed:=v_total_consumed+consumed_quantity;
    v_need:=round(v_need-v_take,8);
    return next;
    exit when v_need <= 0.00000001;
  end loop;

  if v_need > 0.00000001 then
    select coalesce(sum(case when lower(coalesce(sm.movement_type,''))='out' then -sm.quantity else sm.quantity end),0)
    into v_stock_balance
    from public.stock_movements sm where sm.item_id=p_inventory_item_id;

    select coalesce(sum(capacity),0) into v_pool_capacity
    from public.inventory_shared_pools where inventory_item_id=p_inventory_item_id;

    v_unallocated_stock:=round(v_stock_balance-v_pool_capacity,8);

    while v_need > 0.00000001 loop
      if v_unallocated_stock < 1.00000000 then
        raise exception 'Insufficient unallocated shared stock for %. Remaining request fraction: %. Unallocated stock: %.',
          v_item.name,v_need,v_unallocated_stock;
      end if;

      select coalesce(max(pool_number),0)+1 into v_next_pool_number
      from public.inventory_shared_pools where inventory_item_id=p_inventory_item_id;

      insert into public.inventory_shared_pools(
        inventory_item_id,pool_number,capacity,remaining_capacity,status,unit,metadata)
      values(p_inventory_item_id,v_next_pool_number,1,1,'active',v_item.unit,
        jsonb_build_object('created_by','shared_pool_allocator'))
      returning * into v_pool;

      v_unallocated_stock:=round(v_unallocated_stock-1,8);
      v_take:=least(v_need,1);

      update public.inventory_shared_pools
      set remaining_capacity=round(remaining_capacity-v_take,8),
          status=case when remaining_capacity-v_take <= 0.00000001 then 'exhausted' else 'active' end,
          exhausted_at=case when remaining_capacity-v_take <= 0.00000001 then now() else exhausted_at end
      where id=v_pool.id;

      insert into public.pool_allocations(
        pool_id,order_id,order_item_id,menu_item_id,inventory_item_id,
        dish_type,allocation_profile,allocated_fraction,consumed_quantity,unit)
      values(v_pool.id,p_order_id,p_order_item_id,p_menu_item_id,p_inventory_item_id,
        p_dish_type,p_allocation_profile,v_take,v_take,v_item.unit)
      returning id into allocation_id;

      pool_id:=v_pool.id;
      allocated_fraction:=v_take;
      consumed_quantity:=v_take;
      v_total_consumed:=v_total_consumed+v_take;
      v_need:=round(v_need-v_take,8);
      return next;
    end loop;
  end if;

  insert into public.inventory_consumptions(order_id,order_item_id,inventory_item_id,quantity)
  values(p_order_id,p_order_item_id,p_inventory_item_id,v_total_consumed)
  on conflict(order_item_id,inventory_item_id) do nothing;

  if found then
    insert into public.stock_movements(item_id,quantity,movement_type,reason,staff_id)
    values(p_inventory_item_id,v_total_consumed,'out',
      'Order '||p_order_id::text||' shared pool',auth.uid());
  end if;
  return;
end;
$function$;

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
        if v_component_count < 2 then
          raise exception 'Order item % (%): a cocktail requires at least two selected fruit bases',
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

          perform * from public.allocate_and_finalize_shared_pool(
            p_order_id,r.id,r.menu_item_id,spr.inventory_item_id,spr.dish_type,
            (r.qty::numeric / v_component_count),'cocktail');
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

revoke all on function public.allocate_and_finalize_shared_pool(uuid,uuid,uuid,uuid,text,numeric,text) from public;
grant execute on function public.allocate_and_finalize_shared_pool(uuid,uuid,uuid,uuid,text,numeric,text) to authenticated, service_role;

revoke all on function public.finalize_order_inventory(uuid) from public;
grant execute on function public.finalize_order_inventory(uuid) to authenticated, service_role;
