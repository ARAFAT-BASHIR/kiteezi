-- Link a confirmed website booking to one master order without copying the
-- booking or payment into a second ledger. The existing booking remains the
-- booking record; orders.booking_id is the idempotent POS/fulfilment handoff.
begin;

-- Seed buffet bundles as POS-only record-only services so the handoff can create
-- department references without publishing these rows to the public food menu.
insert into public.pos_items
  (category_id,name,description,unit_price,price_on_request,is_available,
   fulfillment_mode,department_key,menu_item_id,img_url,alt_text,serving_unit,
   sort_order,active)
select
  pc.id, b.name, b.description, greatest(0,coalesce(b.price,0)),
  coalesce(b.price,0)<=0, coalesce(b.active,true),
  'record_only','buffet',null,null,null,null,0,true
from public.booking_bundles b
join public.pos_categories pc on pc.name='Buffet & Events'
where coalesce(b.active,true)=true
  and not exists (
    select 1 from public.pos_items pi
    where pi.menu_item_id is null
      and pi.department_key='buffet'
      and lower(pi.name)=lower(b.name)
  );

-- Existing database inspection showed no booking-linked orders. Keep this unique
-- going forward so a booking can never create duplicate master sales.
create unique index if not exists uq_orders_booking_id_not_null
  on public.orders(booking_id) where booking_id is not null;

create or replace function private.sync_confirmed_booking_to_master_order()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare
  v_order_id uuid;
  v_line record;
  v_pos_item_id uuid;
begin
  if new.status = 'confirmed' and old.status is distinct from new.status then
    select id into v_order_id from public.orders where booking_id=new.id;
    if v_order_id is null then
      insert into public.orders
        (customer_id,booking_id,source,status,payment_status,total,created_by,customer_notes,fulfillment_method)
      values
        (new.customer_id,new.id,'website_booking','open','unpaid',coalesce(new.total,0),new.created_by,
         nullif(trim(coalesce(new.notes,'')),''),'dine_in')
      returning id into v_order_id;

      for v_line in
        select bc.id,bc.component_type,bc.menu_item_id,bc.name_snapshot,
               bc.description_snapshot,bc.unit_price,bc.quantity,bc.price_on_request
        from public.booking_components bc
        where bc.booking_id=new.id
        order by bc.created_at,bc.id
      loop
        v_pos_item_id := null;
        if v_line.menu_item_id is not null then
          select pi.id into v_pos_item_id
          from public.pos_items pi
          where pi.menu_item_id=v_line.menu_item_id and pi.active
          limit 1;
        else
          select pi.id into v_pos_item_id
          from public.pos_items pi
          where pi.menu_item_id is null and pi.active
            and lower(pi.name)=lower(v_line.name_snapshot)
          order by case when pi.department_key='buffet' then 0 else 1 end,pi.created_at
          limit 1;
        end if;

        insert into public.order_items
          (order_id,menu_item_id,pos_item_id,item_name_snapshot,qty,unit_price,notes)
        values
          (v_order_id,v_line.menu_item_id,v_pos_item_id,v_line.name_snapshot,
           greatest(1,coalesce(v_line.quantity,1)),greatest(0,coalesce(v_line.unit_price,0)),
           'Booking component: '||coalesce(v_line.component_type,'service'));
      end loop;

      -- A booking may have been paid before it was confirmed. Apply the paid
      -- transition after INSERT so the existing order-payment accounting trigger
      -- sees it exactly once.
      if new.payment_status='paid' then
        update public.orders set payment_status='paid',paid_at=now() where id=v_order_id;
      end if;
    elsif new.payment_status='paid' then
      update public.orders
      set payment_status='paid',paid_at=coalesce(paid_at,now())
      where id=v_order_id and payment_status is distinct from 'paid';
    end if;
  elsif new.payment_status='paid' and old.payment_status is distinct from new.payment_status then
    -- Later booking payments follow the same master order/payment accounting
    -- trigger. Do not reverse a posted payment by changing a booking back to unpaid.
    update public.orders
    set payment_status='paid',paid_at=coalesce(paid_at,now())
    where booking_id=new.id and payment_status is distinct from 'paid';
  end if;
  return new;
end;
$function$;

revoke all on function private.sync_confirmed_booking_to_master_order() from public, anon, authenticated;
drop trigger if exists trg_sync_confirmed_booking_to_master_order on public.bookings;
create trigger trg_sync_confirmed_booking_to_master_order
  after update of status,payment_status on public.bookings
  for each row execute function private.sync_confirmed_booking_to_master_order();

commit;
