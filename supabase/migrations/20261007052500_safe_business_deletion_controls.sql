create or replace function public.admin_delete_business_record(p_type text,p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public','private','pg_catalog','pg_temp'
as $$
declare v_role text; v_name text;
begin
  select role into v_role from public.profiles where id=auth.uid() and active=true;
  if v_role is distinct from 'owner' then raise exception 'Only the owner can permanently remove business records.' using errcode='42501'; end if;
  if p_id is null then raise exception 'The item to remove was not specified.'; end if;
  case lower(trim(p_type))
    when 'team_position' then
      if exists(select 1 from public.profiles where position_id=p_id) then raise exception 'This public position is still assigned to a staff member. Reassign the staff member first.'; end if;
      delete from public.team_positions where id=p_id;
    when 'role' then
      select name into v_name from public.roles where id=p_id;
      if v_name is null then raise exception 'The role could not be found.'; end if;
      if lower(v_name) in ('owner','general_manager','manager','chef','barista','waitstaff','reception','swimming_coach','head_swimming_coach') then raise exception 'This built-in role is protected and cannot be removed.'; end if;
      if exists(select 1 from public.profiles where role=v_name) then raise exception 'This role is still assigned to staff. Change those staff roles first.'; end if;
      delete from public.roles where id=p_id;
    when 'inventory_item' then
      if exists(select 1 from public.inventory_consumptions where inventory_item_id=p_id) or exists(select 1 from public.inventory_daily_counts where inventory_item_id=p_id) or exists(select 1 from public.menu_item_inventory_map where inventory_item_id=p_id) or exists(select 1 from public.menu_item_recipes where inventory_item_id=p_id) or exists(select 1 from public.purchase_order_items where inventory_item_id=p_id) or exists(select 1 from public.requisition_items where inventory_item_id=p_id) or exists(select 1 from public.requisition_version_items where inventory_item_id=p_id) or exists(select 1 from public.order_inventory_reservation_lines where inventory_item_id=p_id) or exists(select 1 from public.inventory_shared_pools where inventory_item_id=p_id) or exists(select 1 from public.pool_allocations where inventory_item_id=p_id) then raise exception 'This inventory item is used in existing records, so it cannot be permanently removed. Mark it inactive instead.'; end if;
      delete from public.inventory_items where id=p_id;
    when 'menu_item' then
      if exists(select 1 from public.order_items where menu_item_id=p_id) or exists(select 1 from public.service_logs where item_id=p_id) or exists(select 1 from public.pool_allocations where menu_item_id=p_id) then raise exception 'This menu item is used in existing records, so it cannot be permanently removed. Mark it out of stock instead.'; end if;
      delete from public.menu_items where id=p_id;
    when 'menu_category' then
      if exists(select 1 from public.menu_items where category_id=p_id) then raise exception 'This menu category still contains menu items. Move them first.'; end if;
      delete from public.menu_categories where id=p_id;
    when 'service' then
      if exists(select 1 from public.bookings where service_id=p_id) then raise exception 'This service has booking history, so it cannot be permanently removed. Mark it inactive instead.'; end if;
      delete from public.services where id=p_id;
    when 'sport' then delete from public.sports where id=p_id;
    when 'service_station' then
      if exists(select 1 from public.inventory_items where station_id=p_id) or exists(select 1 from public.menu_items where station_id=p_id) then raise exception 'This station is still assigned to inventory or menu items. Reassign them first.'; end if;
      delete from public.service_stations where id=p_id;
    when 'social_link' then delete from public.social_links where id=p_id;
    when 'media' then delete from public.media where id=p_id;
    when 'announcement' then delete from public.announcements where id=p_id;
    when 'review' then delete from public.reviews where id=p_id;
    when 'inquiry' then delete from public.notifications where reference_id=p_id; delete from public.email_messages where reference_id=p_id; delete from public.inquiries where id=p_id;
    when 'staff_task' then delete from public.staff_tasks where id=p_id;
    when 'swimming_timetable' then delete from public.swimming_timetable where id=p_id;
    when 'gallery_item' then delete from public.gallery_items where id=p_id;
    when 'customer' then
      if exists(select 1 from public.orders where customer_id=p_id) or exists(select 1 from public.bookings where customer_id=p_id) or exists(select 1 from public.events where customer_id=p_id) or exists(select 1 from public.invoices where customer_id=p_id) or exists(select 1 from public.receipts where customer_id=p_id) or exists(select 1 from public.credit_notes where customer_id=p_id) or exists(select 1 from public.memberships where customer_id=p_id) or exists(select 1 from public.accounts_receivable where customer_id=p_id) then raise exception 'This customer has business history, so the profile cannot be permanently removed. Keep the history and remove only unnecessary personal details instead.'; end if;
      delete from public.customers where id=p_id;
    when 'booking_bundle' then
      if exists(select 1 from public.booking_components where bundle_id=p_id) then raise exception 'This booking package is already used in booking records, so it cannot be permanently removed. Mark it inactive instead.'; end if;
      delete from public.booking_bundles where id=p_id;
    else raise exception 'This record cannot be permanently removed from this screen.';
  end case;
  return true;
end;
$$;
revoke all on function public.admin_delete_business_record(text,uuid) from public;
revoke execute on function public.admin_delete_business_record(text,uuid) from anon;
grant execute on function public.admin_delete_business_record(text,uuid) to authenticated;
