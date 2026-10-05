-- Kiteezi: atomic order inventory reservation workflow
-- Confirm reserves inventory; Completed consumes it; Cancel releases it.
-- Applied to Supabase project recreational on 2026-10-05.

create table if not exists public.order_inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  status text not null default 'reserved' check (status in ('reserved','consumed','released')),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  released_at timestamptz
);

create table if not exists public.order_inventory_reservation_lines (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.order_inventory_reservations(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity numeric not null check (quantity > 0),
  unit text not null,
  created_at timestamptz not null default now(),
  unique (reservation_id, order_item_id, inventory_item_id)
);

alter table public.pool_allocations
  add column if not exists reservation_id uuid references public.order_inventory_reservations(id) on delete set null,
  add column if not exists allocation_status text not null default 'consumed'
    check (allocation_status in ('reserved','consumed','released'));

create index if not exists idx_order_inventory_reservations_order_status
  on public.order_inventory_reservations(order_id,status);
create index if not exists idx_order_inventory_reservation_lines_inventory
  on public.order_inventory_reservation_lines(inventory_item_id);
create index if not exists idx_pool_allocations_reservation_status
  on public.pool_allocations(reservation_id,allocation_status);

alter table public.order_inventory_reservations enable row level security;
alter table public.order_inventory_reservation_lines enable row level security;

drop policy if exists order_inventory_reservations_owner_all on public.order_inventory_reservations;
drop policy if exists order_inventory_reservations_staff_select on public.order_inventory_reservations;
create policy order_inventory_reservations_owner_all on public.order_inventory_reservations
  for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy order_inventory_reservations_staff_select on public.order_inventory_reservations
  for select to authenticated using (private.has_permission('orders.manage'));

drop policy if exists order_inventory_reservation_lines_owner_all on public.order_inventory_reservation_lines;
drop policy if exists order_inventory_reservation_lines_staff_select on public.order_inventory_reservation_lines;
create policy order_inventory_reservation_lines_owner_all on public.order_inventory_reservation_lines
  for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy order_inventory_reservation_lines_staff_select on public.order_inventory_reservation_lines
  for select to authenticated using (private.has_permission('orders.manage'));

-- confirm_order_inventory, release_order_inventory_reservation,
-- finalize_order_inventory and admin_set_order_status are installed
-- in the live project by the corresponding production migration.
-- The central status RPC is the only browser-facing mutation path.