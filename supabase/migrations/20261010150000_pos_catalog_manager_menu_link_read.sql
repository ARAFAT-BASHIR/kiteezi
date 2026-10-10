-- Managers who maintain the private POS catalog need to choose linked menu
-- items for kitchen/barista routing. This grants SELECT only, not menu editing.
begin;
drop policy if exists pos_managers_read_menu_item_links on public.menu_items;
create policy pos_managers_read_menu_item_links
  on public.menu_items
  for select to authenticated
  using (private.is_owner() or private.has_permission('orders.manage'));
commit;
