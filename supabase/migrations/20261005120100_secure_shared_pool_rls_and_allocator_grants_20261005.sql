-- Shared-pool security hardening.
-- Apply after the live shared-pool reconciliation migration.

drop policy if exists "Owner full access" on public.inventory_shared_pools;
drop policy if exists "Staff manage shared pools" on public.inventory_shared_pools;
create policy "Owner full access" on public.inventory_shared_pools for all to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "Staff read shared pools" on public.inventory_shared_pools for select to authenticated
  using (private.has_permission('inventory.manage'));

drop policy if exists "Owner full access" on public.pool_allocations;
drop policy if exists "Staff read pool allocations" on public.pool_allocations;
create policy "Owner full access" on public.pool_allocations for all to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "Staff read pool allocations" on public.pool_allocations for select to authenticated
  using (private.has_permission('inventory.manage'));

drop policy if exists "Owner full access" on public.shared_pool_menu_rules;
drop policy if exists "Staff manage shared pool rules" on public.shared_pool_menu_rules;
create policy "Owner full access" on public.shared_pool_menu_rules for all to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy "Staff manage shared pool rules" on public.shared_pool_menu_rules for all to authenticated
  using (private.has_permission('inventory.manage') and private.has_permission('menu.manage'))
  with check (private.has_permission('inventory.manage') and private.has_permission('menu.manage'));

revoke all on function public.allocate_and_finalize_shared_pool(uuid,uuid,uuid,uuid,text,numeric,text) from anon;
revoke all on function public.allocate_and_finalize_shared_pool(uuid,uuid,uuid,uuid,text,numeric,text) from public;
grant execute on function public.allocate_and_finalize_shared_pool(uuid,uuid,uuid,uuid,text,numeric,text) to authenticated, service_role;
