-- Complete the POS-only service catalog and protect linked preparation routes.
-- This migration is intentionally additive and idempotent. It does not create a
-- second sale or payment for a booking; bookings remain their existing financial
-- source of truth.
begin;

-- A linked menu item must remain available as a routing/recipe reference. Do not
-- silently orphan a prepared POS item when someone deletes its public menu row.
alter table public.pos_items drop constraint if exists pos_items_menu_item_id_fkey;
alter table public.pos_items
  add constraint pos_items_menu_item_id_fkey
  foreign key (menu_item_id) references public.menu_items(id) on delete restrict;

-- Categorize existing public buffet/event menu rows in the POS catalog without
-- changing their public website category or publishing any POS-only entries.
update public.pos_items pi
set category_id = pc.id, updated_at = now()
from public.menu_items mi
join public.menu_categories mc on mc.id = mi.category_id
join public.pos_categories pc on pc.name = 'Buffet & Events'
where pi.menu_item_id = mi.id
  and lower(coalesce(mc.name,'')) ~ '(buffet|event|catering|banquet)'
  and pi.category_id is distinct from pc.id;

-- Seed the standalone services into the POS catalog as record-only items.
-- They remain linked to bookings/services only by name and service department;
-- they are not duplicate orders, booking records, or payments.
insert into public.pos_items
  (category_id,name,description,unit_price,price_on_request,is_available,
   fulfillment_mode,department_key,menu_item_id,img_url,alt_text,serving_unit,
   sort_order,active)
select
  pc.id,
  s.name,
  s.description,
  greatest(0,coalesce(s.price,0)),
  coalesce(s.price,0) <= 0,
  coalesce(s.active,true),
  'record_only',
  case
    when lower(coalesce(s.category,'')) like '%swim%' then 'swimming'
    when lower(coalesce(s.category,'')) like '%sport%' then 'sports'
    when lower(coalesce(s.category,'')) like '%photo%' then 'photography'
    when lower(coalesce(s.category,'')) ~ '(buffet|event|catering|banquet)' then 'buffet'
    else 'other'
  end,
  null,null,null,null,
  0,true
from public.services s
join public.pos_categories pc on pc.name =
  case
    when lower(coalesce(s.category,'')) like '%swim%' then 'Swimming'
    when lower(coalesce(s.category,'')) like '%sport%' then 'Sports'
    when lower(coalesce(s.category,'')) like '%photo%' then 'Photography'
    when lower(coalesce(s.category,'')) ~ '(buffet|event|catering|banquet)' then 'Buffet & Events'
    else 'Buffet & Events'
  end
where coalesce(s.active,true) = true
  and lower(coalesce(s.category,'')) ~ '(swim|sport|photo|buffet|event|catering|banquet)'
  and not exists (
    select 1 from public.pos_items existing
    where existing.menu_item_id is null
      and lower(existing.name) = lower(s.name)
      and existing.department_key = case
        when lower(coalesce(s.category,'')) like '%swim%' then 'swimming'
        when lower(coalesce(s.category,'')) like '%sport%' then 'sports'
        when lower(coalesce(s.category,'')) like '%photo%' then 'photography'
        when lower(coalesce(s.category,'')) ~ '(buffet|event|catering|banquet)' then 'buffet'
        else 'other'
      end
  );

-- The POS catalog can represent explicitly free services. Price-on-request
-- items remain unavailable for direct checkout until their price is resolved.
create or replace function public.create_pos_order_v2(
  p_customer_name text,
  p_phone text,
  p_items jsonb,
  p_notes text default null,
  p_fulfillment_method text default 'dine_in'
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare
  v_customer uuid;
  v_order uuid;
  v jsonb;
  v_pos_item public.pos_items%rowtype;
  v_qty numeric;
  v_total numeric := 0;
begin
  if not (private.has_permission('orders.manage') or private.has_permission('orders.create')) then
    raise exception 'Not authorized';
  end if;
  if lower(coalesce(p_fulfillment_method,'')) not in ('dine_in','pickup','delivery') then
    raise exception 'Invalid fulfillment method';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then
    raise exception 'At least one item is required';
  end if;

  if coalesce(trim(p_customer_name),'') <> '' or coalesce(trim(p_phone),'') <> '' then
    insert into public.customers(name,phone)
    values(nullif(trim(coalesce(p_customer_name,'')),''),nullif(trim(coalesce(p_phone,'')),''))
    returning id into v_customer;
  end if;

  insert into public.orders
    (customer_id,source,status,payment_status,total,created_by,customer_notes,fulfillment_method)
  values
    (v_customer,'pos','open','unpaid',0,auth.uid(),nullif(trim(coalesce(p_notes,'')),''),lower(p_fulfillment_method))
  returning id into v_order;

  for v in select value from jsonb_array_elements(p_items) loop
    if coalesce(v->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Invalid POS item ID';
    end if;
    select pi.* into v_pos_item
    from public.pos_items pi
    join public.pos_categories pc on pc.id = pi.category_id and pc.active
    where pi.id = (v->>'id')::uuid
      and pi.active = true
      and pi.is_available = true
      and pi.price_on_request = false
    for share of pi;
    if not found then raise exception 'One of the POS items is unavailable or priced on request'; end if;

    v_qty := coalesce((v->>'quantity')::numeric,1);
    if v_qty <= 0 or v_qty > 10000 then raise exception 'Quantity must be greater than zero and within the allowed limit'; end if;
    if v_pos_item.fulfillment_mode = 'preparation' and v_pos_item.menu_item_id is null then
      raise exception 'Prepared food and drinks must link to a menu item for kitchen/barista routing and inventory';
    end if;
    if v_pos_item.menu_item_id is not null and not exists (
      select 1 from public.menu_items mi
      where mi.id = v_pos_item.menu_item_id
        and mi.in_stock = true
        and coalesce(mi.price_on_request,false) = false
    ) then
      raise exception 'A linked menu item is unavailable';
    end if;

    insert into public.order_items
      (order_id,menu_item_id,pos_item_id,item_name_snapshot,qty,unit_price,notes)
    values
      (v_order,v_pos_item.menu_item_id,v_pos_item.id,v_pos_item.name,v_qty,v_pos_item.unit_price,null);
    v_total := v_total + v_qty * v_pos_item.unit_price;
  end loop;

  update public.orders set total = v_total where id = v_order;
  return v_order;
end;
$function$;

revoke all on function public.create_pos_order_v2(text,text,jsonb,text,text) from public, anon;
grant execute on function public.create_pos_order_v2(text,text,jsonb,text,text) to authenticated, service_role;

commit;
