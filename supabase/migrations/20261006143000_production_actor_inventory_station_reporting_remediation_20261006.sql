-- Canonical production remediation migration. Applied to live Supabase 2026-10-06.
update public.services set pricing_mode='per_person_team' where lower(name) in ('basketball','football') and small_group_price is not null and full_team_price is not null and team_threshold is not null;
alter table public.audit_logs add column if not exists actor_name text, add column if not exists actor_role text, add column if not exists actor_department text;

CREATE OR REPLACE FUNCTION public.audit_operational_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
declare v_actor uuid:=auth.uid(); v_action text; v_entity_id uuid; v_details jsonb;
begin
  if tg_op='INSERT' then v_action:=lower(tg_table_name)||'.created';v_entity_id:=new.id;v_details:=jsonb_build_object('operation','INSERT');
  elsif tg_op='UPDATE' then v_action:=lower(tg_table_name)||'.updated';v_entity_id:=new.id;v_details:=jsonb_build_object('operation','UPDATE');
  else v_action:=lower(tg_table_name)||'.deleted';v_entity_id:=old.id;v_details:=jsonb_build_object('operation','DELETE'); end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values(v_actor,v_action,tg_table_name,v_entity_id,v_details);
  return coalesce(new,old);
end;
$function$


CREATE OR REPLACE FUNCTION public.confirm_order_inventory(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
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
             select coalesce(sum(capacity),0) into v_pool_capacity from public.inventory_shared_pools where inventory_item_id=spr.inventory_item_id;
             v_unallocated:=round(v_stock-v_pool_capacity,8);
             if v_unallocated<1 then raise exception 'Insufficient inventory for %. Required shared fraction remaining: %. Available unallocated stock: %.',v_inventory.name,v_need,greatest(v_unallocated,0); end if;
             select coalesce(max(pool_number),0)+1 into v_next_pool_number from public.inventory_shared_pools where inventory_item_id=spr.inventory_item_id;
             insert into public.inventory_shared_pools(inventory_item_id,pool_number,capacity,remaining_capacity,status,unit,metadata) values(spr.inventory_item_id,v_next_pool_number,1,1,'active',v_inventory.unit,jsonb_build_object('created_by','order_reservation')) returning * into v_pool;
             v_take:=least(v_need,1);
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
             select coalesce(max(pool_number),0)+1 into v_next_pool_number from public.inventory_shared_pools where inventory_item_id=spr.inventory_item_id;
             insert into public.inventory_shared_pools(inventory_item_id,pool_number,capacity,remaining_capacity,status,unit,metadata) values(spr.inventory_item_id,v_next_pool_number,1,1,'active',v_inventory.unit,jsonb_build_object('created_by','order_reservation')) returning * into v_pool; v_take:=least(v_need,1);
           end if;
           update public.inventory_shared_pools set remaining_capacity=round(remaining_capacity-v_take,8),status=case when remaining_capacity-v_take<=0.00000001 then 'exhausted' else 'active' end,exhausted_at=case when remaining_capacity-v_take<=0.00000001 then now() else exhausted_at end where id=v_pool.id;
           insert into public.pool_allocations(pool_id,order_id,order_item_id,menu_item_id,inventory_item_id,dish_type,allocation_profile,allocated_fraction,consumed_quantity,unit,reservation_id,allocation_status) values(v_pool.id,p_order_id,r.id,r.menu_item_id,spr.inventory_item_id,spr.dish_type,coalesce(r.shared_pool_profile,spr.allocation_profile),v_take,v_take*v_pool.capacity,v_inventory.unit,v_reservation_id,'reserved');
           v_need:=round(v_need-v_take,8);
         end loop;
       end loop;
     end if;
   else
     if not exists(select 1 from public.menu_item_recipes mir where mir.menu_item_id=r.menu_item_id) then raise exception 'No inventory recipe or shared-pool rule exists for menu item "%". Confirmation refused.',r.menu_item_name; end if;
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
$function$


CREATE OR REPLACE FUNCTION public.fill_audit_actor_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
declare p public.profiles%rowtype;
begin
  if new.actor_id is not null then
    select * into p from public.profiles where id=new.actor_id limit 1;
    if found then
      new.actor_name:=coalesce(new.actor_name,p.full_name);
      new.actor_role:=coalesce(new.actor_role,p.role);
      new.actor_department:=coalesce(new.actor_department,
        case lower(coalesce(p.role,''))
          when 'chef' then 'Kitchen' when 'head_chef' then 'Kitchen'
          when 'barista' then 'Bar' when 'bartender' then 'Bar'
          when 'grounds_cleaning' then 'Grounds' when 'waitstaff' then 'Service'
          when 'head_swimming_coach' then 'Swimming' when 'swimming_coach' then 'Swimming'
          when 'manager' then 'Management' when 'general_manager' then 'Management'
          when 'ceo' then 'Management' when 'owner' then 'Management'
          else p.role end);
    end if;
  end if;
  return new;
end;
$function$


CREATE OR REPLACE FUNCTION public.get_station_order_workflow(p_station text)
 RETURNS TABLE(order_id uuid, created_at timestamp with time zone, source text, customer_name text, customer_phone text, fulfillment_method text, order_status text, station_id uuid, station_name text, station_status text, station_sort_order integer, cancellation_reason text, cancelled_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
begin
  if lower(p_station)='kitchen' then
    if not private.has_permission('orders.station_kitchen') then raise exception 'Not authorized'; end if;
  elsif lower(p_station)='barista' then
    if not private.has_permission('orders.station_barista') then raise exception 'Not authorized'; end if;
  else raise exception 'Invalid station'; end if;
  return query
  select o.id,o.created_at,o.source,c.name,c.phone,o.fulfillment_method,o.status,
         ss.id,ss.name,osp.status,ss.sort_order,osp.cancellation_reason,osp.cancelled_at
  from public.orders o
  join public.order_station_progress osp on osp.order_id=o.id
  join public.service_stations ss on ss.id=osp.station_id
  left join public.customers c on c.id=o.customer_id
  where lower(ss.name)=lower(p_station)
  order by o.created_at desc,ss.sort_order;
end;
$function$


CREATE OR REPLACE FUNCTION public.set_order_station_status(p_order_id uuid, p_station_id uuid, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
declare v_station_name text; v_order_status text; v_allowed boolean:=false; v_total integer; v_complete integer;
begin
  if not (private.has_permission('orders.manage') or private.has_permission('orders.station_kitchen') or private.has_permission('orders.station_barista')) then raise exception 'Not authorized'; end if;
  if p_status not in('waiting','in_progress','complete') then raise exception 'Invalid station status'; end if;
  select name into v_station_name from public.service_stations where id=p_station_id and active;
  if v_station_name is null then raise exception 'Station not found'; end if;
  if private.has_permission('orders.manage') then v_allowed:=true;
  elsif lower(v_station_name)='kitchen' and private.has_permission('orders.station_kitchen') then v_allowed:=true;
  elsif lower(v_station_name)='barista' and private.has_permission('orders.station_barista') then v_allowed:=true; end if;
  if not v_allowed then raise exception 'Your permissions cannot operate this station'; end if;
  select status into v_order_status from public.orders where id=p_order_id for update;
  if v_order_status<>'confirmed' then raise exception 'Station work can only be changed after the order is confirmed'; end if;
  if not exists(select 1 from public.order_station_progress where order_id=p_order_id and station_id=p_station_id) then raise exception 'This station is not assigned to the order'; end if;
  update public.order_station_progress set status=p_status,
    started_at=case when p_status='in_progress' and started_at is null then now() else started_at end,
    completed_at=case when p_status='complete' then coalesce(completed_at,now()) when p_status<>'complete' then null else completed_at end,
    updated_at=now()
  where order_id=p_order_id and station_id=p_station_id;
  select count(*),count(*) filter(where status='complete') into v_total,v_complete from public.order_station_progress where order_id=p_order_id;
  return true;
end; $function$


CREATE OR REPLACE FUNCTION public.set_order_station_status(p_order_id uuid, p_station_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
declare v_station_name text;v_order_status text;v_allowed boolean:=false;
begin
  if not (private.has_permission('orders.manage') or private.has_permission('orders.station_kitchen') or private.has_permission('orders.station_barista')) then raise exception 'Not authorized'; end if;
  if p_status not in ('waiting','accepted','in_progress','complete','cancelled') then raise exception 'Invalid station status'; end if;
  if p_status='cancelled' and nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'A cancellation reason is required'; end if;
  select name into v_station_name from public.service_stations where id=p_station_id and active;
  if v_station_name is null then raise exception 'Station not found'; end if;
  if private.has_permission('orders.manage') then v_allowed:=true;
  elsif lower(v_station_name)='kitchen' and private.has_permission('orders.station_kitchen') then v_allowed:=true;
  elsif lower(v_station_name)='barista' and private.has_permission('orders.station_barista') then v_allowed:=true; end if;
  if not v_allowed then raise exception 'Your permissions cannot operate this station'; end if;
  select status into v_order_status from public.orders where id=p_order_id for update;
  if v_order_status is null then raise exception 'Order not found'; end if;
  if v_order_status in ('cancelled','completed') and p_status not in ('cancelled','waiting') then raise exception 'This order is already closed'; end if;
  if v_order_status in ('pending','open') and p_status in ('in_progress','complete') then
    raise exception 'The station may accept a pending order, but preparation/completion starts after manager confirmation';
  end if;
  if not exists(select 1 from public.order_station_progress where order_id=p_order_id and station_id=p_station_id) then raise exception 'This station is not assigned to the order'; end if;
  update public.order_station_progress
  set status=p_status,
      started_at=case when p_status in ('accepted','in_progress') and started_at is null then now() else started_at end,
      completed_at=case when p_status='complete' then coalesce(completed_at,now()) when p_status<>'complete' then null else completed_at end,
      cancellation_reason=case when p_status='cancelled' then trim(p_reason) else null end,
      cancelled_at=case when p_status='cancelled' then now() else null end,
      cancelled_by=case when p_status='cancelled' then auth.uid() else null end,
      updated_at=now()
  where order_id=p_order_id and station_id=p_station_id;
  return true;
end;
$function$


insert into public.permissions(code,description) values ('inventory.service','Access service/waitstaff inventory scope') on conflict(code) do nothing;
do $do$ declare r text; begin foreach r in array array['chef','head_chef','barista','bartender','grounds_cleaning','head_swimming_coach','swimming_coach','waitstaff','storekeeper'] loop if exists(select 1 from public.roles where name=r) then insert into public.role_permissions(role_id,permission_id) select ro.id,p.id from public.roles ro cross join public.permissions p where ro.name=r and p.code in ('inventory.manage','inventory.count','inventory.adjust','inventory.view') on conflict do nothing; end if; end loop; end $do$;

do $do$ begin
if exists(select 1 from information_schema.tables where table_schema='public' and table_name='events') then drop policy if exists "Reports can read events" on public.events; create policy "Reports can read events" on public.events for select to authenticated using (private.has_permission('reports.view')); end if;
drop policy if exists "Reports can read stock movements" on public.stock_movements; create policy "Reports can read stock movements" on public.stock_movements for select to authenticated using (private.has_permission('reports.view'));
drop policy if exists "Reports can read daily counts" on public.inventory_daily_counts; create policy "Reports can read daily counts" on public.inventory_daily_counts for select to authenticated using (private.has_permission('reports.view'));
drop policy if exists "Reports can read inventory" on public.inventory_items; create policy "Reports can read inventory" on public.inventory_items for select to authenticated using (private.has_permission('reports.view'));
end $do$;

update public.booking_components bc set unit_price=case when b.people<s.team_threshold then s.small_group_price else s.full_team_price end from public.bookings b join public.services s on s.id=b.service_id where bc.booking_id=b.id and bc.service_id=s.id and lower(s.name) in ('basketball','football') and bc.price_on_request=false;
update public.bookings b set total=coalesce((select sum(line_total) from public.booking_components bc where bc.booking_id=b.id),0) where b.service_id in (select id from public.services where lower(name) in ('basketball','football')) and b.total=0;

drop trigger if exists trg_audit_stock_movements on public.stock_movements; create trigger trg_audit_stock_movements after insert or update or delete on public.stock_movements for each row execute function public.audit_operational_change();
drop trigger if exists trg_audit_inventory_daily_counts on public.inventory_daily_counts; create trigger trg_audit_inventory_daily_counts after insert or update or delete on public.inventory_daily_counts for each row execute function public.audit_operational_change();
drop trigger if exists trg_audit_inventory_items on public.inventory_items; create trigger trg_audit_inventory_items after insert or update or delete on public.inventory_items for each row execute function public.audit_operational_change();
drop trigger if exists trg_audit_bookings on public.bookings; create trigger trg_audit_bookings after insert or update or delete on public.bookings for each row execute function public.audit_operational_change();
drop trigger if exists trg_audit_orders on public.orders; create trigger trg_audit_orders after insert or update or delete on public.orders for each row execute function public.audit_operational_change();
drop trigger if exists trg_audit_order_station_progress on public.order_station_progress; create trigger trg_audit_order_station_progress after insert or update or delete on public.order_station_progress for each row execute function public.audit_operational_change();
