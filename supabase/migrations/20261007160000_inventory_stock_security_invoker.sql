-- Prevent the inventory stock view from bypassing underlying table RLS.
alter view public.inventory_stock set (security_invoker = true);
