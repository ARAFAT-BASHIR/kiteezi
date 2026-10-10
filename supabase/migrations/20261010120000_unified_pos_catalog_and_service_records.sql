-- Dedicated POS catalog and unified mixed-service order lines.
-- POS catalog rows are private to the POS; they do not publish to the public menu.
create table if not exists public.pos_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_categories_name_unique unique (name)
);

create table if not exists public.pos_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.pos_categories(id) on delete restrict,
  name text not null,
  description text,
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  price_on_request boolean not null default false,
  is_available boolean not null default true,
  fulfillment_mode text not null default 'record_only'
    check (fulfillment_mode in ('preparation','record_only')),
  department_key text not null
    check (department_key in ('kitchen','barista','swimming','sports','photography','buffet','other')),
  -- Link prepared food/drink to the existing menu item so existing station and
  -- recipe/inventory logic remains in force. Service-only entries stay unlinked.
  menu_item_id uuid unique references public.menu_items(id) on delete set null,
  img_url text,
  alt_text text,
  serving_unit text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_preparation_requires_menu_item
    check (fulfillment_mode <> 'preparation' or menu_item_id is not null)
);

create index if not exists idx_pos_items_category_active
  on public.pos_items(category_id, active, sort_order, name);
create index if not exists idx_pos_items_department
  on public.pos_items(department_key, active);

alter table public.pos_categories enable row level security;
alter table public.pos_items enable row level security;

drop policy if exists pos_categories_staff_read on public.pos_categories;
create policy pos_categories_staff_read on public.pos_categories
  for select to authenticated
  using (private.has_permission('orders.create') or private.has_permission('orders.manage'));

drop policy if exists pos_categories_manager_write on public.pos_categories;
create policy pos_categories_manager_write on public.pos_categories
  for all to authenticated
  using (private.is_owner() or private.has_permission('orders.manage'))
  with check (private.is_owner() or private.has_permission('orders.manage'));

drop policy if exists pos_items_staff_read on public.pos_items;
create policy pos_items_staff_read on public.pos_items
  for select to authenticated
  using (private.has_permission('orders.create') or private.has_permission('orders.manage'));

drop policy if exists pos_items_manager_write on public.pos_items;
create policy pos_items_manager_write on public.pos_items
  for all to authenticated
  using (private.is_owner() or private.has_permission('orders.manage'))
  with check (private.is_owner() or private.has_permission('orders.manage'));

grant select, insert, update, delete on public.pos_categories, public.pos_items to authenticated;

-- Existing preparation/reporting functions continue to work for linked menu items.
-- Standalone service lines must be allowed to omit menu_item_id.
alter table public.order_items alter column menu_item_id drop not null;
alter table public.order_items
  add column if not exists pos_item_id uuid references public.pos_items(id) on delete restrict;

create index if not exists idx_order_items_pos_item_id on public.order_items(pos_item_id);

-- Keep a departmental record as a reference to the authoritative order line.
-- Record-only services intentionally have no preparation/cancellation progress.
create table if not exists public.pos_department_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null unique references public.order_items(id) on delete restrict,
  pos_item_id uuid not null references public.pos_items(id) on delete restrict,
  department_key text not null
    check (department_key in ('swimming','sports','photography','buffet','other')),
  item_name_snapshot text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  notes text
);
create index if not exists idx_pos_department_records_department_date
  on public.pos_department_records(department_key, recorded_at desc);
create index if not exists idx_pos_department_records_order
  on public.pos_department_records(order_id);

alter table public.pos_department_records enable row level security;
drop policy if exists pos_department_records_authorized_read on public.pos_department_records;
create policy pos_department_records_authorized_read on public.pos_department_records
  for select to authenticated
  using (
    private.is_owner()
    or private.has_permission('orders.manage')
    or private.has_permission('orders.department.' || department_key)
  );
drop policy if exists pos_department_records_manager_write on public.pos_department_records;
create policy pos_department_records_manager_write on public.pos_department_records
  for all to authenticated
  using (private.is_owner() or private.has_permission('orders.manage'))
  with check (private.is_owner() or private.has_permission('orders.manage'));
grant select, insert, update, delete on public.pos_department_records to authenticated;

-- When an order is confirmed, record-only services create a reference record once.
-- These rows never become a second sales ledger and do not get preparation states.
create or replace function private.record_pos_services_after_confirmation()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
begin
  if new.status = 'confirmed' and old.status is distinct from new.status then
    insert into public.pos_department_records
      (order_id, order_item_id, pos_item_id, department_key,
       item_name_snapshot, quantity, unit_price, recorded_by, notes)
    select oi.order_id, oi.id, pi.id, pi.department_key,
           coalesce(oi.item_name_snapshot, pi.name), oi.qty, oi.unit_price,
           auth.uid(), oi.notes
    from public.order_items oi
    join public.pos_items pi on pi.id = oi.pos_item_id
    where oi.order_id = new.id
      and pi.fulfillment_mode = 'record_only'
      and pi.department_key in ('swimming','sports','photography','buffet','other')
    on conflict (order_item_id) do nothing;
  end if;
  return new;
end;
$function$;
revoke all on function private.record_pos_services_after_confirmation() from public, anon, authenticated;
drop trigger if exists trg_record_pos_services_after_confirmation on public.orders;
create trigger trg_record_pos_services_after_confirmation
  after update of status on public.orders
  for each row execute function private.record_pos_services_after_confirmation();

-- POS now accepts IDs from pos_items, never menu_categories/menu_items directly.
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

  insert into public.orders(customer_id,source,status,payment_status,total,created_by,customer_notes,fulfillment_method)
  values(v_customer,'pos','open','unpaid',0,auth.uid(),nullif(trim(coalesce(p_notes,'')),''),lower(p_fulfillment_method))
  returning id into v_order;

  for v in select value from jsonb_array_elements(p_items) loop
    select * into v_pos_item
      from public.pos_items pi
      join public.pos_categories pc on pc.id = pi.category_id and pc.active
      where pi.id = (v->>'id')::uuid
        and pi.active = true
        and pi.is_available = true
        and pi.price_on_request = false
      for share of pi;
    if not found then raise exception 'One of the POS items is unavailable or priced on request'; end if;
    if v_pos_item.unit_price <= 0 then raise exception 'POS item must have a price greater than zero'; end if;
    v_qty := greatest(1, coalesce((v->>'quantity')::numeric,1));
    if v_pos_item.fulfillment_mode = 'preparation' and v_pos_item.menu_item_id is null then
      raise exception 'Prepared food and drinks must be linked to their existing menu item for kitchen/barista routing and inventory';
    end if;
    if v_pos_item.menu_item_id is not null and not exists (
      select 1 from public.menu_items mi
      where mi.id = v_pos_item.menu_item_id and mi.in_stock = true
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
