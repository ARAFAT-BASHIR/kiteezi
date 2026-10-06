-- Canonical production remediation migration; live database applied 2026-10-06.
update public.services set pricing_mode='per_person_team' where lower(name) in ('basketball','football') and small_group_price is not null and full_team_price is not null and team_threshold is not null;
alter table public.audit_logs add column if not exists actor_name text, add column if not exists actor_role text, add column if not exists actor_department text;



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
