-- Kiteezi: auto-complete POS orders that require no preparation.
-- Record-only/service items skip kitchen/bar station progress. After authorized
-- confirmation, orders with zero required stations complete immediately; payment
-- remains separate. Mixed/preparation orders retain the existing station workflow.
begin;

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
  left join public.pos_items pi on pi.id = oi.pos_item_id
  where oi.order_id = p_order_id
    and mi.station_id is not null
    and (oi.pos_item_id is null or pi.fulfillment_mode = 'preparation')
  group by oi.order_id, mi.station_id
  on conflict (order_id, station_id) do nothing;
end;
$function$;

revoke all on function private.initialize_order_station_progress(uuid) from public, anon, authenticated;

create or replace function public.admin_set_order_status(
  p_order_id uuid,
  p_status text default null,
  p_payment_status text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare
  v_old_status text;
  v_role text;
  v_station_count integer;
  v_complete_count integer;
begin
  if not private.has_permission('orders.manage') then
    raise exception 'Not authorized';
  end if;
  if p_status is null and p_payment_status is null then
    raise exception 'No order change supplied';
  end if;
  if p_payment_status is not null and p_payment_status <> 'paid' then
    raise exception 'Payment can only be marked as paid through this action';
  end if;

  select status into v_old_status
  from public.orders where id = p_order_id for update;
  if not found then return false; end if;

  if p_payment_status = 'paid' and v_old_status = 'cancelled' then
    raise exception 'A cancelled order cannot be newly marked as paid';
  end if;

  select role into v_role from public.profiles where id = auth.uid();

  if p_status = 'confirmed' and v_old_status in ('pending', 'open') then
    perform public.confirm_order_inventory(p_order_id);
    perform private.initialize_order_station_progress(p_order_id);

    select count(*) into v_station_count
    from public.order_station_progress where order_id = p_order_id;

    if v_station_count = 0 then
      -- Nothing to prepare: complete immediately after authorized confirmation.
      perform public.finalize_order_inventory(p_order_id);
      update public.orders
      set status = 'completed',
          payment_status = coalesce(p_payment_status, payment_status)
      where id = p_order_id;
      return true;
    end if;
  elsif p_status = 'completed' and v_old_status <> 'completed' then
    if v_old_status <> 'confirmed' then
      raise exception 'Order must be confirmed before it can be completed';
    end if;
    if v_role in ('chef', 'barista') then
      raise exception 'Station staff must complete their station, not the whole order';
    end if;
    select count(*), count(*) filter (where status = 'complete')
      into v_station_count, v_complete_count
    from public.order_station_progress where order_id = p_order_id;
    if v_station_count > 0 and v_complete_count <> v_station_count then
      raise exception 'All required stations must be complete before the order can be completed';
    end if;
    perform public.finalize_order_inventory(p_order_id);
  elsif p_status = 'cancelled' then
    raise exception 'Use the admin cancellation action with a required cancellation reason';
  elsif p_status is not null and p_status <> v_old_status then
    raise exception 'Invalid order status transition from % to %', v_old_status, p_status;
  end if;

  update public.orders
  set status = coalesce(p_status, status),
      payment_status = coalesce(p_payment_status, payment_status)
  where id = p_order_id;
  return true;
end;
$function$;

commit;
