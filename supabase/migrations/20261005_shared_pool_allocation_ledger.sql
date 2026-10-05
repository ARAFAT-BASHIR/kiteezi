-- Shared-pool allocation ledger — authoritative production source of truth.
-- Reconciled from Supabase project aldpezvbetliuvagiekg on 2026-10-05.
-- This migration is idempotent and documents the production architecture:
-- physical shared pools -> fractional allocations -> atomic inventory finalization.

create table if not exists public.inventory_shared_pools (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  pool_number bigint not null,
  capacity numeric not null default 1.00000000 check (capacity > 0),
  remaining_capacity numeric not null default 1.00000000
    check (remaining_capacity >= 0 and remaining_capacity <= capacity),
  status text not null default 'active'
    check (status in ('active','exhausted','closed')),
  unit text not null,
  created_at timestamptz not null default now(),
  exhausted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (inventory_item_id,pool_number)
);

create table if not exists public.pool_allocations (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.inventory_shared_pools(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  dish_type text not null,
  allocation_profile text,
  allocated_fraction numeric not null check (allocated_fraction > 0),
  consumed_quantity numeric not null check (consumed_quantity > 0),
  unit text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.shared_pool_menu_rules (
  id uuid primary key default gen_random_uuid(),
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete restrict,
  dish_type text not null,
  fraction_per_menu_unit numeric check (fraction_per_menu_unit is null or fraction_per_menu_unit > 0),
  allocation_profile text,
  requires_profile boolean not null default false,
  requires_components boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inventory_shared_pools_active
  on public.inventory_shared_pools(inventory_item_id,status,pool_number);
create index if not exists idx_pool_allocations_order_item
  on public.pool_allocations(order_item_id,inventory_item_id);
create index if not exists idx_pool_allocations_pool
  on public.pool_allocations(pool_id,created_at);
create index if not exists idx_shared_pool_menu_rules_menu
  on public.shared_pool_menu_rules(menu_item_id,active);

alter table public.inventory_shared_pools enable row level security;
alter table public.pool_allocations enable row level security;
alter table public.shared_pool_menu_rules enable row level security;

-- The production RPC definitions are intentionally kept in the database migration
-- history as the executable implementation. This repository migration records the
-- schema contract and security boundary; later hardening migrations own permissions.
--
-- IMPORTANT:
-- allocate_and_finalize_shared_pool() and finalize_order_inventory() are SECURITY
-- DEFINER functions and must validate orders.manage internally. They must never be
-- executable by anon/PUBLIC.
--
-- Production grants:
--   allocate_and_finalize_shared_pool: authenticated, service_role
--   finalize_order_inventory: authenticated, service_role
--
-- Production behavior:
--   * physical stock is represented by pools with capacity 1.0
--   * menu uses consume fractions of a physical pool
--   * advisory transaction locks serialize competing allocations
--   * an allocation is idempotent through inventory_consumptions
--   * stock movement is recorded only once
--   * cocktail components are explicit; the system never guesses missing components
--   * shared resources cannot be multiplied across recipes
--   * inventory finalization is an authoritative database operation
