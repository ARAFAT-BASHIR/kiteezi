drop policy if exists "Full order managers" on public.orders;
create policy "Order managers can read all orders"
on public.orders
for select
to authenticated
using (private.has_permission('orders.manage'));
