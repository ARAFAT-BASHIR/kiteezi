-- Non-inventory menu items may be sold without a recipe or shared-pool rule.
-- Such items must not block confirmation or create inventory consumption.

create or replace function public.confirm_order_inventory(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare r record; recipe record; spr record; v_reservation_id uuid; v_stock numeric; v_reserved numeric; v_available numeric; v_need numeric; v_fraction numeric; v_component_count integer; v_pool public.inventory_shared_pools%rowtype; v_take numeric; v_unallocated numeric; v_pool_capacity numeric; v_next_pool_number bigint; v_inventory public.inventory_items%rowtype; v_existing uuid;
begin
 if not private.has_permission('orders.manage') then raise exception 'Not authorized'; end if;
 select id into v_existing from public.order_inventory_reservations where order_id=p_order_id and status='reserved' limit 1;
 if v_existing is not null then return true; end if;
 if not exists(select 1 from public.orders where id=p_order_id and status in ('pending','open')) then raise exception 'Order is not pending and cannot be confirmed'; end if;
 insert into public.order_inventory_reservations(order_id,status) values(p_order_id,'reserved') returning id into v_reservation_id;
 for r in select oi.id,oi.menu_item_id,oi.qty,oi.shared_pool_profile,oi.shared_pool_fraction,oi.shared_pool_components,mi.name menu_item_name,coalesce(mi.inventory_tracked,true) inventory_tracked from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id where oi.order_id=p_order_id order by oi.id loop
   if not r.inventory_tracked then continue; end if;
   if exists(select 1 from public.shared_pool_menu_rules where menu_item_id=r.menu_item_id and active) then
     if exists(select 1 from public.shared_pool_menu_rules where menu_item_id=r.menu_item_id and active and requires_components) then
       if jsonb_typeof(r.shared_pool_components)<>'array' or jsonb_array_length(r.shared_pool_components)=0 then raise exception 'Order item % (%): cocktail components are required before confirmation',r.id,r.menu_item_name; end if;
       select count(*) into v_component_count from jsonb_array_elements(r.shared_pool_components);
       for spr in select (x->>'inventory_item_id')::uuid inventory_item_id,coalesce(x->>'dish_type','cocktail_component') dish_type from jsonb_array_elements(r.shared_pool_components) x loop
         if not exists(select 1 from public.inventory_items i where i.id=spr.inventory_item_id and i.name in ('Orange','Lemon','Pineapple','Passion fruit','Beetroot','Watermelon','Mango') and i.active) then raise exception 'Invalid cocktail fruit inventory item %',spr.inventory_item_id; end if;
         v_need:=round(r.qty::numeric/v_component_count,8); select * into v_inventory from public.inventory_items where id=spr.inventory_item_id and active for update; perform pg_advisory_xact_lock(hashtextextended('shared-pool:'||spr.inventory_item_id::text,0));
         while v_need>0.00000001 loop
           select * into v_pool from public.inventory_shared_pools where inventory_item_id=spr.inventory_item_id and status='active' and remaining_capacity>0 order by pool_number limit 1 for update;
           if found then v_take:=least(v_need,v_pool.remaining_capacity); else
             select coalesce(sum(case when lower(coalesce(sm.movement_type,''))='out' then -sm.quantity else sm.quantity end),0) into v_stock from public.stock_movements sm where sm.item_id=spr.inventory_item_id;
             select coalesce(sum(capacity),0) into v_pool_capacity from public.inventory_shared_pools where inventory_item_id=spr.inventory_item_id; v_unallocated:=round(v_stock-v_pool_capacity,8);
             if v_unallocated<1 then raise exception 'Insufficient inventory for %. Required shared fraction remaining: %. Available unallocated stock: %.',v_inventory.name,v_need,greatest(v_unallocated,0); end if;
             select coalesce(max(pool_number),0)+1 into v_next_pool_number from public.inventory_shared_pools where inventory_item_id=spr.inventory_item_id;
             insert into public.inventory_shared_pools(inventory_item_id,pool_number,capacity,remaining_capacity,status,unit,metadata) values(spr.inventory_item_id,v_next_pool_number,1,1,'active',v_inventory.unit,jsonb_build_object('created_by','order_reservation')) returning * into v_pool; v_take:=least(v_need,1);
           end if;
           update public.inventory_shared_pools set remaining_capacity=round(remaining_capacity-v_take,8),status=case when remaining_capacity-v_take<=0.00000001 then 'exhausted' else 'active' end,exhausted_at=case when remaining_capacity-v_take<=0.00000001 then now() else exhausted_at end where id=v_pool.id;
           insert into public.pool_allocations(pool_id,order_id,order_item_id,menu_item_id,inventory_item_id,dish_type,allocation_profile,allocated_fraction,consumed_quantity,unit,reservation_id,allocation_status) values(v_pool.id,p_order_id,r.id,r.menu_item_id,spr.inventory_item_id,spr.dish_type,'cocktail',v_take,v_take*v_pool.capacity,v_inventory.unit,v_reservation_id,'reserved');
           v_need:=round(v_need-v_take,8);
         end loop;
       end loop;
     else
       for spr in select * from public.shared_pool_menu_rules where menu_item_id=r.menu_item_id and active and not requires_components and (allocation_profile is null or allocation_profile=r.shared_pool_profile) loop
         if spr.requires_profile and r.shared_pool_profile is null then raise exception 'Order item % (%): production profile is required before confirmation',r.id,r.menu_item_name; end if;
         if spr.fraction_per_menu_unit is null then if r.shared_pool_fraction is null then raise exception 'Order item % (%): explicit shared-pool fraction is required; the system will not guess',r.id,r.menu_item_name; end if; v_fraction:=r.shared_pool_fraction*r.qty; else v_fraction:=spr.fraction_per_menu_unit*r.qty; end if;
         select * into v_inventory from public.inventory_items where id=spr.inventory_item_id and active for update; perform pg_advisory_xact_lock(hashtextextended('shared-pool:'||spr.inventory_item_id::text,0)); v_need:=round(v_fraction,8);
         while v_need>0.00000001 loop
           select * into v_pool from public.inventory_shared_pools where inventory_item_id=spr.inventory_item_id and status='active' and remaining_capacity>0 order by pool_number limit 1 for update;
           if found then v_take:=least(v_need,v_pool.remaining_capacity); else
             select coalesce(sum(case when lower(coalesce(sm.movement_type,''))='out' then -sm.quantity else sm.quantity end),0) into v_stock from public.stock_movements sm where sm.item_id=spr.inventory_item_id;
             select coalesce(sum(capacity),0) into v_pool_capacity from public.inventory_shared_pools where inventory_item_id=spr.inventory_item_id; v_unallocated:=round(v_stock-v_pool_capacity,8);
             if v_unallocated<1 then raise exception 'Insufficient inventory for %. Required shared fraction remaining: %. Available unallocated stock: %.',v_inventory.name,v_need,greatest(v_unallocated,0); end if;
             select coalesce(max(pool_number),0)+1 into v_next_pool_number from public.inventory_shared_pools where inventory_item_id=spr.inventory_item_id; insert into public.inventory_shared_pools(inventory_item_id,pool_number,capacity,remaining_capacity,status,unit,metadata) values(spr.inventory_item_id,v_next_pool_number,1,1,'active',v_inventory.unit,jsonb_build_object('created_by','order_reservation')) returning * into v_pool; v_take:=least(v_need,1);
           end if;
           update public.inventory_shared_pools set remaining_capacity=round(remaining_capacity-v_take,8),status=case when remaining_capacity-v_take<=0.00000001 then 'exhausted' else 'active' end,exhausted_at=case when remaining_capacity-v_take<=0.00000001 then now() else exhausted_at end where id=v_pool.id;
           insert into public.pool_allocations(pool_id,order_id,order_item_id,menu_item_id,inventory_item_id,dish_type,allocation_profile,allocated_fraction,consumed_quantity,unit,reservation_id,allocation_status) values(v_pool.id,p_order_id,r.id,r.menu_item_id,spr.inventory_item_id,spr.dish_type,coalesce(r.shared_pool_profile,spr.allocation_profile),v_take,v_take*v_pool.capacity,v_inventory.unit,v_reservation_id,'reserved');
           v_need:=round(v_need-v_take,8);
         end loop;
       end loop;
     end if;
   else
     -- No recipe + no shared-pool rule = non-inventory item. Let it pass.
     if not exists(select 1 from public.menu_item_recipes mir where mir.menu_item_id=r.menu_item_id) then continue; end if;
     for recipe in select mir.inventory_item_id,mir.quantity*coalesce(mir.stock_units_per_recipe_unit,1)*r.qty qty,ii.unit,ii.name from public.menu_item_recipes mir join public.inventory_items ii on ii.id=mir.inventory_item_id and ii.active where mir.menu_item_id=r.menu_item_id loop
       perform pg_advisory_xact_lock(hashtextextended('direct-stock:'||recipe.inventory_item_id::text,0));
       select coalesce(sum(case when lower(coalesce(sm.movement_type,''))='out' then -sm.quantity else sm.quantity end),0) into v_stock from public.stock_movements sm where sm.item_id=recipe.inventory_item_id;
       select coalesce(sum(rl.quantity),0) into v_reserved from public.order_inventory_reservation_lines rl join public.order_inventory_reservations rr on rr.id=rl.reservation_id where rl.inventory_item_id=recipe.inventory_item_id and rr.status='reserved';
       v_available:=round(v_stock-v_reserved,8); if v_available+0.00000001<recipe.qty then raise exception 'Insufficient inventory for %. Required: %, available: %.',recipe.name,recipe.qty,greatest(v_available,0); end if;
       insert into public.order_inventory_reservation_lines(reservation_id,order_item_id,inventory_item_id,quantity,unit) values(v_reservation_id,r.id,recipe.inventory_item_id,recipe.qty,recipe.unit) on conflict(reservation_id,order_item_id,inventory_item_id) do update set quantity=excluded.quantity;
     end loop;
   end if;
 end loop;
 return true;
end;
$function$;

create or replace function public.finalize_order_inventory(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare r record; recipe record; spr record; v_fraction numeric; v_component_count integer;
begin
  if not private.has_permission('orders.manage') then raise exception 'Not authorized'; end if;
  if not exists (select 1 from public.orders where id=p_order_id) then raise exception 'Order % does not exist', p_order_id; end if;
  for r in select oi.id,oi.menu_item_id,oi.qty,oi.shared_pool_profile,oi.shared_pool_fraction,oi.shared_pool_components,mi.name menu_item_name from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id where oi.order_id=p_order_id order by oi.id loop
    if exists (select 1 from public.shared_pool_menu_rules where menu_item_id=r.menu_item_id and active) then
      if exists (select 1 from public.shared_pool_menu_rules where menu_item_id=r.menu_item_id and active and requires_components) then
        if jsonb_typeof(r.shared_pool_components)<>'array' or jsonb_array_length(r.shared_pool_components)=0 then raise exception 'Order item % (%): cocktail components are required before inventory can be finalized',r.id,r.menu_item_name; end if;
        select count(*) into v_component_count from jsonb_array_elements(r.shared_pool_components);
        if v_component_count<1 or v_component_count>3 then raise exception 'Order item % (%): cocktail requires 1 to 3 selected fruit bases',r.id,r.menu_item_name; end if;
        for spr in select (x->>'inventory_item_id')::uuid inventory_item_id,coalesce(x->>'dish_type','cocktail_component') dish_type from jsonb_array_elements(r.shared_pool_components) x loop
          if not exists(select 1 from public.inventory_items i where i.id=spr.inventory_item_id and i.name in ('Orange','Lemon','Pineapple','Passion fruit','Beetroot','Watermelon','Mango') and i.active) then raise exception 'Invalid cocktail fruit inventory item %',spr.inventory_item_id; end if;
          v_fraction:=case when v_component_count=1 then 0.25 when v_component_count=2 then 0.50 when v_component_count=3 then 1.0/3.0 end;
          perform * from public.allocate_and_finalize_shared_pool(p_order_id,r.id,r.menu_item_id,spr.inventory_item_id,spr.dish_type,r.qty::numeric*v_fraction,'cocktail');
        end loop;
      else
        for spr in select * from public.shared_pool_menu_rules where menu_item_id=r.menu_item_id and active and not requires_components and (allocation_profile is null or allocation_profile=r.shared_pool_profile) loop
          if spr.requires_profile and r.shared_pool_profile is null then raise exception 'Order item % (%): production profile is required before shared chicken stock can be allocated',r.id,r.menu_item_name; end if;
          if spr.fraction_per_menu_unit is null then if r.shared_pool_fraction is null then raise exception 'Order item % (%): explicit shared-pool fraction is required; the system will not guess',r.id,r.menu_item_name; end if; v_fraction:=r.shared_pool_fraction*r.qty; else v_fraction:=spr.fraction_per_menu_unit*r.qty; end if;
          perform * from public.allocate_and_finalize_shared_pool(p_order_id,r.id,r.menu_item_id,spr.inventory_item_id,spr.dish_type,v_fraction,coalesce(r.shared_pool_profile,spr.allocation_profile));
        end loop;
      end if;
    else
      -- No recipe + no shared-pool rule = non-inventory item. Let it pass.
      if not exists(select 1 from public.menu_item_recipes mir where mir.menu_item_id=r.menu_item_id) then continue; end if;
      for recipe in select mir.inventory_item_id,mir.quantity*coalesce(mir.stock_units_per_recipe_unit,1)*r.qty qty from public.menu_item_recipes mir where mir.menu_item_id=r.menu_item_id loop
        insert into public.inventory_consumptions(order_id,order_item_id,inventory_item_id,quantity) values(p_order_id,r.id,recipe.inventory_item_id,recipe.qty) on conflict(order_item_id,inventory_item_id) do nothing;
        if found then insert into public.stock_movements(item_id,quantity,movement_type,reason,staff_id) values(recipe.inventory_item_id,recipe.qty,'out','Order '||p_order_id::text,auth.uid()); end if;
      end loop;
    end if;
  end loop;
  return true;
end;
$function$;

revoke all on function public.confirm_order_inventory(uuid) from public;
grant execute on function public.confirm_order_inventory(uuid) to authenticated, service_role;
revoke all on function public.finalize_order_inventory(uuid) from public;
grant execute on function public.finalize_order_inventory(uuid) to authenticated, service_role;
