drop policy if exists "Authorized operations staff can read customers" on public.customers;
create policy "Authorized operations staff can read customers"
on public.customers
for select
to authenticated
using (
  private.is_owner()
  or private.has_permission('bookings.view')
  or private.has_permission('bookings.manage')
  or private.has_permission('orders.view')
  or private.has_permission('orders.manage')
);
