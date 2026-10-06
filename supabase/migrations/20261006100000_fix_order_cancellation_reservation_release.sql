-- Kiteezi: fix order cancellation reservation release
-- The reservation release implementation is private; public cancellation RPCs
-- must call the private internal helper so anonymous website cancellations do
-- not fail with "function private.release_order_inventory_reservation(uuid) does not exist".

create or replace function public.cancel_public_order(p_order_id uuid,p_phone text)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_phone text:=private.normalize_phone(p_phone);v_customer_id uuid;v_status text;
begin
 select c.id,o.status into v_customer_id,v_status
 from public.orders o
 join public.customers c on c.id=o.customer_id
 where o.id=p_order_id and o.source='website' and c.phone=v_phone
 for update;

 if v_customer_id is null then
   raise exception 'No matching order was found for this phone number.';
 end if;
 if v_status='cancelled' then return true; end if;
 if v_status='completed' then
   raise exception 'This order can no longer be cancelled online.';
 end if;
 if v_status not in('pending','open','confirmed') then
   raise exception 'This order cannot be cancelled online in its current state.';
 end if;

 if v_status='confirmed' then
   perform private.release_order_inventory_reservation_internal(p_order_id);
 end if;

 update public.order_station_progress
 set status='cancelled',updated_at=now()
 where order_id=p_order_id and status<>'complete';

 update public.orders set status='cancelled' where id=p_order_id;

 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
 values(null,'customer_order_cancelled','order',p_order_id,
        jsonb_build_object('source','public'));

 return true;
end; $$;

create or replace function public.admin_cancel_order(p_order_id uuid,p_reason text)
returns boolean language plpgsql security definer
set search_path=public,private,pg_catalog,pg_temp as $$
declare v_old_status text;
begin
 if not private.has_permission('orders.manage') then
   raise exception 'Not authorized';
 end if;
 if trim(coalesce(p_reason,'')) not in(
   'Customer requested cancellation','Out of stock','Customer unreachable',
   'Operational issue','Duplicate order','Other'
 ) then
   raise exception 'A valid cancellation reason is required';
 end if;

 select status into v_old_status
 from public.orders where id=p_order_id for update;

 if not found then return false; end if;
 if v_old_status in('completed','cancelled') then
   raise exception 'This order cannot be cancelled in its current state.';
 end if;

 perform private.release_order_inventory_reservation_internal(p_order_id);

 update public.order_station_progress
 set status='cancelled',updated_at=now()
 where order_id=p_order_id and status<>'complete';

 update public.orders set status='cancelled' where id=p_order_id;

 insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
 values(auth.uid(),'admin_order_cancelled','order',p_order_id,
        jsonb_build_object('reason',p_reason));

 return true;
end; $$;
