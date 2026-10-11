drop policy if exists "Active staff can manage customers" on public.customers;
create policy "Authorized operations staff can read customers"
on public.customers
for select
to authenticated
using (
  private.is_owner()
  or private.has_permission('bookings.view')
  or private.has_permission('bookings.create')
  or private.has_permission('orders.view')
  or private.has_permission('orders.manage')
  or private.has_permission('orders.create')
);
