-- Kiteezi production ordering, station tracking, public cancellation and phone normalization
-- Source-of-truth migration for the live contract applied 2026-10-05.

create or replace function private.normalize_phone(p_phone text)
returns text
language plpgsql immutable
set search_path = pg_catalog
as $$
declare v text:=regexp_replace(trim(coalesce(p_phone,'')),'[^0-9+]','','g'); d text;
begin
 if v='' then raise exception 'Phone number is required'; end if;
 if left(v,1)='+' then d:=substring(v from 2);
 elsif left(v,2)='00' then d:=substring(v from 3);
 else d:=v; end if;
 if d ~ '^0[0-9]+$' then
   if length(d)=10 and left(d,2)='07' then d:='256'||substring(d from 2);
   else raise exception 'Enter an international phone number with country code, or a valid Uganda number.'; end if;
 elsif d ~ '^7[0-9]{8}$' then d:='256'||d; end if;
 if d !~ '^[1-9][0-9]{7,14}$' then raise exception 'Invalid phone number. Use a country code such as +256700190708.'; end if;
 return '+'||d;
end;
$$;
revoke all on function private.normalize_phone(text) from public,anon,authenticated;

create table if not exists public.order_station_progress(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.orders(id) on delete cascade,
 station_id uuid not null references public.service_stations(id),
 status text not null default 'waiting' check(status in('waiting','in_progress','complete','cancelled')),
 started_at timestamptz, completed_at timestamptz, updated_at timestamptz not null default now(),
 unique(order_id,station_id)
);
create index if not exists idx_order_station_progress_order on public.order_station_progress(order_id,station_id);
alter table public.order_station_progress enable row level security;
drop policy if exists order_station_progress_owner_all on public.order_station_progress;
drop policy if exists order_station_progress_staff_select on public.order_station_progress;
drop policy if exists order_station_progress_staff_update on public.order_station_progress;
create policy order_station_progress_owner_all on public.order_station_progress for all to authenticated using(private.is_owner()) with check(private.is_owner());
create policy order_station_progress_staff_select on public.order_station_progress for select to authenticated using(private.has_permission('orders.manage'));
create policy order_station_progress_staff_update on public.order_station_progress for update to authenticated using(private.has_permission('orders.manage')) with check(private.has_permission('orders.manage'));

create or replace function private.release_order_inventory_reservation_internal(p_order_id uuid)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_reservation_id uuid; r record;
begin
 select id into v_reservation_id from public.order_inventory_reservations where order_id=p_order_id and status='reserved' for update;
 if v_reservation_id is null then return true; end if;
 for r in select pa.id,pa.pool_id,pa.allocated_fraction from public.pool_allocations pa where pa.reservation_id=v_reservation_id and pa.allocation_status='reserved' order by pa.id for update loop
   update public.inventory_shared_pools set remaining_capacity=round(remaining_capacity+r.allocated_fraction,8),status='active',exhausted_at=null where id=r.pool_id;
   update public.pool_allocations set allocation_status='released' where id=r.id;
 end loop;
 update public.order_inventory_reservations set status='released',released_at=now() where id=v_reservation_id and status='reserved';
 return true;
end; $$;
revoke all on function private.release_order_inventory_reservation_internal(uuid) from public,anon,authenticated;

create or replace function public.release_order_inventory_reservation(p_order_id uuid)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
begin
 if not private.has_permission('orders.manage') then raise exception 'Not authorized'; end if;
 return private.release_order_inventory_reservation_internal(p_order_id);
end; $$;
revoke all on function public.release_order_inventory_reservation(uuid) from public,anon,authenticated;
grant execute on function public.release_order_inventory_reservation(uuid) to service_role;

create or replace function public.place_website_order(p_customer_name text,p_phone text,p_email text default null,p_fulfillment_method text default 'pickup',p_delivery_address text default null,p_customer_notes text default null,p_items jsonb default '[]'::jsonb)
returns table(order_id uuid,order_total numeric) language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_customer_id uuid;v_order_id uuid;v_phone text:=private.normalize_phone(p_phone);v_total numeric:=0;v_item jsonb;v_menu_item public.menu_items%rowtype;v_qty numeric;
begin
 if nullif(trim(p_customer_name),'') is null then raise exception 'Customer name is required'; end if;
 if lower(coalesce(p_fulfillment_method,'pickup')) not in('pickup','delivery','dine_in') then raise exception 'Fulfillment method must be pickup, delivery, or dine in'; end if;
 if lower(coalesce(p_fulfillment_method,'pickup'))='delivery' and nullif(trim(coalesce(p_delivery_address,'')),'') is null then raise exception 'Delivery address is required for delivery orders'; end if;
 if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'At least one menu item is required'; end if;
 select c.id into v_customer_id from public.customers c where c.phone=v_phone limit 1;
 if v_customer_id is null then insert into public.customers(name,phone,email) values(trim(p_customer_name),v_phone,nullif(trim(coalesce(p_email,'')),'')) returning id into v_customer_id;
 else update public.customers set name=trim(p_customer_name),email=coalesce(nullif(trim(coalesce(p_email,'')),''),email) where id=v_customer_id; end if;
 insert into public.orders(customer_id,source,status,payment_status,total,fulfillment_method,delivery_address,customer_notes) values(v_customer_id,'website','pending','unpaid',0,lower(coalesce(p_fulfillment_method,'pickup')),nullif(trim(coalesce(p_delivery_address,'')),''),nullif(trim(coalesce(p_customer_notes,'')),'')) returning id into v_order_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
   if nullif(v_item->>'menu_item_id','') is null then raise exception 'Each order item requires a menu_item_id'; end if;
   v_qty:=greatest(1,coalesce((v_item->>'qty')::numeric,1));
   select * into v_menu_item from public.menu_items mi where mi.id=(v_item->>'menu_item_id')::uuid and mi.in_stock=true and coalesce(mi.price_on_request,false)=false and coalesce(mi.price,0)>0;
   if not found then raise exception 'One of the selected menu items is unavailable or is priced on request'; end if;
   insert into public.order_items(order_id,menu_item_id,qty,unit_price,notes) values(v_order_id,v_menu_item.id,v_qty,v_menu_item.price,nullif(trim(coalesce(v_item->>'notes','')),''));
   v_total:=v_total+(v_menu_item.price*v_qty);
 end loop;
 update public.orders set total=v_total where id=v_order_id;
 return query select v_order_id,v_total;
end; $$;
revoke all on function public.place_website_order(text,text,text,text,text,text,jsonb) from public,authenticated;
grant execute on function public.place_website_order(text,text,text,text,text,text,jsonb) to anon;

create or replace function public.get_public_orders_by_phone(p_phone text)
returns table(order_id uuid,status text,payment_status text,total numeric,created_at timestamptz,station_progress jsonb)
language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_phone text:=private.normalize_phone(p_phone);
begin
 return query with recent as(
   select o.id,o.status,o.payment_status,o.total,o.created_at from public.orders o join public.customers c on c.id=o.customer_id
   where o.source='website' and c.phone=v_phone order by o.created_at desc limit 4
 )
 select r.id,r.status,r.payment_status,r.total,r.created_at,
   case when r.status='cancelled' then '[]'::jsonb when count(osp.id)=0 then '[]'::jsonb
   else jsonb_agg(jsonb_build_object('station_id',osp.station_id,'station_name',ss.name,'status',osp.status) order by ss.sort_order,ss.name) end
 from recent r left join public.order_station_progress osp on osp.order_id=r.id left join public.service_stations ss on ss.id=osp.station_id
 group by r.id,r.status,r.payment_status,r.total,r.created_at order by r.created_at desc;
end; $$;
revoke all on function public.get_public_orders_by_phone(text) from public,authenticated;
grant execute on function public.get_public_orders_by_phone(text) to anon;

create or replace function public.cancel_public_order(p_order_id uuid,p_phone text)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_phone text:=private.normalize_phone(p_phone);v_customer_id uuid;v_status text;
begin
 select c.id,o.status into v_customer_id,v_status from public.orders o join public.customers c on c.id=o.customer_id where o.id=p_order_id and o.source='website' and c.phone=v_phone for update;
 if v_customer_id is null then raise exception 'No matching order was found for this phone number.'; end if;
 if v_status='cancelled' then return true; end if;
 if v_status='completed' then raise exception 'This order can no longer be cancelled online.'; end if;
 if v_status not in('pending','open','confirmed') then raise exception 'This order cannot be cancelled online in its current state.'; end if;
 if v_status='confirmed' then perform private.release_order_inventory_reservation(p_order_id); end if;
 update public.order_station_progress set status='cancelled',updated_at=now() where order_id=p_order_id and status<>'complete';
 update public.orders set status='cancelled' where id=p_order_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(null,'customer_order_cancelled','order',p_order_id,jsonb_build_object('source','public'));
 return true;
end; $$;
revoke all on function public.cancel_public_order(uuid,text) from public,authenticated;
grant execute on function public.cancel_public_order(uuid,text) to anon;

create or replace function private.initialize_order_station_progress(p_order_id uuid)
returns void language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
begin
 insert into public.order_station_progress(order_id,station_id,status)
 select distinct oi.order_id,mi.station_id,'waiting' from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id join public.service_stations ss on ss.id=mi.station_id and ss.active
 where oi.order_id=p_order_id and mi.station_id is not null on conflict(order_id,station_id) do nothing;
end; $$;
revoke all on function private.initialize_order_station_progress(uuid) from public,anon,authenticated;

create or replace function public.admin_set_order_status(p_order_id uuid,p_status text default null,p_payment_status text default null)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_old_status text;v_role text;v_station_count integer;v_complete_count integer;
begin
 if not private.has_permission('orders.manage') then raise exception 'Not authorized'; end if;
 if p_status is null and p_payment_status is null then raise exception 'No order change supplied'; end if;
 select status into v_old_status from public.orders where id=p_order_id for update;
 if not found then return false; end if;
 select role into v_role from public.profiles where id=auth.uid();
 if p_status='confirmed' and v_old_status in('pending','open') then perform public.confirm_order_inventory(p_order_id);perform private.initialize_order_station_progress(p_order_id);
 elsif p_status='completed' and v_old_status<>'completed' then
   if v_old_status<>'confirmed' then raise exception 'Order must be confirmed before it can be completed'; end if;
   if v_role in('chef','barista') then raise exception 'Station staff must complete their station, not the whole order'; end if;
   select count(*),count(*) filter(where status='complete') into v_station_count,v_complete_count from public.order_station_progress where order_id=p_order_id;
   if v_station_count>0 and v_complete_count<>v_station_count then raise exception 'All required stations must be complete before the order can be completed'; end if;
   perform public.finalize_order_inventory(p_order_id);
 elsif p_status='cancelled' then raise exception 'Use the admin cancellation action with a required cancellation reason';
 elsif p_status is not null and p_status<>v_old_status then raise exception 'Invalid order status transition from % to %',v_old_status,p_status; end if;
 update public.orders set status=coalesce(p_status,status),payment_status=coalesce(p_payment_status,payment_status) where id=p_order_id;
 return true;
end; $$;
revoke all on function public.admin_set_order_status(uuid,text,text) from public,anon;
grant execute on function public.admin_set_order_status(uuid,text,text) to authenticated,service_role;

create or replace function public.admin_cancel_order(p_order_id uuid,p_reason text)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_old_status text;
begin
 if not private.has_permission('orders.manage') then raise exception 'Not authorized'; end if;
 if trim(coalesce(p_reason,'')) not in('Customer requested cancellation','Out of stock','Customer unreachable','Operational issue','Duplicate order','Other') then raise exception 'A valid cancellation reason is required'; end if;
 select status into v_old_status from public.orders where id=p_order_id for update;
 if not found then return false; end if;
 if v_old_status in('completed','cancelled') then raise exception 'This order cannot be cancelled in its current state.'; end if;
 perform private.release_order_inventory_reservation(p_order_id);
 update public.order_station_progress set status='cancelled',updated_at=now() where order_id=p_order_id and status<>'complete';
 update public.orders set status='cancelled' where id=p_order_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'admin_order_cancelled','order',p_order_id,jsonb_build_object('reason',p_reason));
 return true;
end; $$;
revoke all on function public.admin_cancel_order(uuid,text) from public,anon;
grant execute on function public.admin_cancel_order(uuid,text) to authenticated,service_role;

create or replace function public.set_order_station_status(p_order_id uuid,p_station_id uuid,p_status text)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_role text;v_station_name text;v_order_status text;v_allowed boolean:=false;v_count integer;v_complete integer;
begin
 if not private.has_permission('orders.manage') then raise exception 'Not authorized'; end if;
 if p_status not in('waiting','in_progress','complete') then raise exception 'Invalid station status'; end if;
 select role into v_role from public.profiles where id=auth.uid();
 select name into v_station_name from public.service_stations where id=p_station_id and active;
 if v_station_name is null then raise exception 'Station not found'; end if;
 if v_role='chef' then v_allowed:=v_station_name='Kitchen'; elsif v_role='barista' then v_allowed:=v_station_name='Barista'; elsif v_role in('owner','manager','general_manager','ceo','reception_manager') then v_allowed:=true; end if;
 if not v_allowed then raise exception 'Your role cannot operate this station'; end if;
 select status into v_order_status from public.orders where id=p_order_id for update;
 if v_order_status<>'confirmed' then raise exception 'Station work can only be changed after the order is confirmed'; end if;
 if not exists(select 1 from public.order_station_progress where order_id=p_order_id and station_id=p_station_id) then raise exception 'This station is not required for this order'; end if;
 update public.order_station_progress set status=p_status,started_at=case when p_status='in_progress' and started_at is null then now() else started_at end,completed_at=case when p_status='complete' then coalesce(completed_at,now()) else completed_at end,updated_at=now() where order_id=p_order_id and station_id=p_station_id;
 select count(*),count(*) filter(where status='complete') into v_count,v_complete from public.order_station_progress where order_id=p_order_id;
 if v_count>0 and v_complete=v_count then perform public.finalize_order_inventory(p_order_id);update public.orders set status='completed' where id=p_order_id and status='confirmed'; end if;
 return true;
end; $$;
revoke all on function public.set_order_station_status(uuid,uuid,text) from public,anon;
grant execute on function public.set_order_station_status(uuid,uuid,text) to authenticated,service_role;

-- Booking phone normalization and customer cancellation.
create or replace function public.submit_public_booking_v3(p_customer_name text,p_phone text,p_email text,p_booking_date date,p_start_time time,p_people integer,p_notes text,p_components jsonb)
returns jsonb language plpgsql security definer set search_path=public,private,pg_catalog,pg_temp as $$
declare v_customer_id uuid;v_booking_id uuid;v_primary_service uuid;v_service_category text;v_total numeric:=0;v_on_request boolean:=false;v_has_catering boolean:=false;c jsonb;r record;v_qty integer;v_phone text:=private.normalize_phone(p_phone);
begin
 if coalesce(trim(p_customer_name),'')='' then raise exception 'Customer name is required';end if;
 if p_booking_date is null then raise exception 'Booking date is required';end if;
 if p_booking_date<current_date then raise exception 'Booking date cannot be in the past';end if;
 if p_people is null or p_people<1 then raise exception 'People must be at least 1';end if;
 if jsonb_typeof(coalesce(p_components,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_components,'[]'::jsonb))=0 then raise exception 'Select at least one service or booking item';end if;
 select c.id into v_customer_id from public.customers c where c.phone=v_phone limit 1;
 if v_customer_id is null then insert into public.customers(name,phone,email) values(trim(p_customer_name),v_phone,nullif(trim(p_email),'')) returning id into v_customer_id; else update public.customers set name=trim(p_customer_name),email=coalesce(nullif(trim(p_email),''),email) where id=v_customer_id; end if;
 insert into public.bookings(customer_id,service_id,booking_date,start_time,people,source,status,payment_status,total,total_on_request,notes) values(v_customer_id,null,p_booking_date,p_start_time,p_people,'website','pending','unpaid',0,false,nullif(trim(p_notes),'')) returning id into v_booking_id;
 for c in select value from jsonb_array_elements(p_components) loop
   if lower(coalesce(c->>'type','')) not in('service','menu_item','buffet') then raise exception 'Unsupported booking component type';end if;
   v_qty:=greatest(1,coalesce((c->>'quantity')::integer,p_people));
   select * into r from public.calculate_booking_component_price(lower(c->>'type'),(c->>'id')::uuid,v_qty);
   insert into public.booking_components(booking_id,component_type,service_id,menu_item_id,reference_key,name_snapshot,description_snapshot,unit_price,quantity,price_on_request) values(v_booking_id,lower(c->>'type'),r.service_id,r.menu_item_id,r.reference_key,r.name_snapshot,r.description_snapshot,r.unit_price,v_qty,r.price_on_request);
   if v_primary_service is null and r.service_id is not null then v_primary_service:=r.service_id;end if;
   if lower(c->>'type') in('menu_item','buffet') then v_has_catering:=true;end if;
   v_total:=v_total+coalesce(r.line_total,0);v_on_request:=v_on_request or r.price_on_request;
 end loop;
 select lower(coalesce(category,'')) into v_service_category from public.services where id=v_primary_service;
 if v_service_category is null then raise exception 'A valid primary service is required';end if;
 if v_service_category not in('sports','swimming') and not v_has_catering then raise exception 'Catering is required for this booking type. Please select a buffet or menu item.';end if;
 update public.bookings set service_id=v_primary_service,total=v_total,total_on_request=v_on_request where id=v_booking_id;
 return jsonb_build_object('booking_id',v_booking_id,'customer_id',v_customer_id,'total',v_total,'total_on_request',v_on_request);
end; $$;
revoke all on function public.submit_public_booking_v3(text,text,text,date,time,integer,text,jsonb) from public,authenticated;
grant execute on function public.submit_public_booking_v3(text,text,text,date,time,integer,text,jsonb) to anon;

create or replace function public.get_public_booking_status(p_booking_id uuid,p_phone text)
returns table(booking_id uuid,status text,payment_status text,total numeric,total_on_request boolean,booking_date date,start_time time,created_at timestamptz)
language sql security definer set search_path=public,private,pg_catalog,pg_temp as $$
 select b.id,b.status,b.payment_status,b.total,b.total_on_request,b.booking_date,b.start_time,b.created_at from public.bookings b join public.customers c on c.id=b.customer_id where b.id=p_booking_id and c.phone=private.normalize_phone(p_phone) and b.source='website' limit 1
$$;
revoke all on function public.get_public_booking_status(uuid,text) from public,authenticated;
grant execute on function public.get_public_booking_status(uuid,text) to anon;

create or replace function public.cancel_public_booking(p_booking_id uuid,p_phone text)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_phone text:=private.normalize_phone(p_phone);v_status text;
begin
 select b.status into v_status from public.bookings b join public.customers c on c.id=b.customer_id where b.id=p_booking_id and b.source='website' and c.phone=v_phone for update;
 if v_status is null then raise exception 'No matching booking was found for this phone number.';end if;
 if v_status='cancelled' then return true;end if;
 if v_status in('completed','paid') then raise exception 'This booking can no longer be cancelled online.';end if;
 update public.bookings set status='cancelled',cancellation_reason='Customer requested cancellation' where id=p_booking_id;
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(null,'customer_booking_cancelled','booking',p_booking_id,jsonb_build_object('source','public'));
 return true;
end; $$;
revoke all on function public.cancel_public_booking(uuid,text) from public,authenticated;
grant execute on function public.cancel_public_booking(uuid,text) to anon;

create or replace function public.admin_cancel_booking(p_booking_id uuid,p_reason text)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
begin
 if not private.has_permission('bookings.manage') then raise exception 'Not authorized';end if;
 if trim(coalesce(p_reason,''))='' then raise exception 'Cancellation reason is required';end if;
 if not exists(select 1 from public.bookings where id=p_booking_id) then return false;end if;
 update public.bookings set status='cancelled',cancellation_reason=trim(p_reason) where id=p_booking_id and status not in('completed','cancelled');
 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values(auth.uid(),'admin_booking_cancelled','booking',p_booking_id,jsonb_build_object('reason',trim(p_reason)));
 return true;
end; $$;
revoke all on function public.admin_cancel_booking(uuid,text) from public,anon;
grant execute on function public.admin_cancel_booking(uuid,text) to authenticated,service_role;
