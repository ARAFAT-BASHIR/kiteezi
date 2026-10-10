-- Owner-only test-data cleanup expansion.
-- Intentionally excludes audit logs and master/configuration tables.
alter table public.requisitions add column if not exists deleted_at timestamptz; alter table public.requisitions add column if not exists deleted_by uuid references public.profiles(id); alter table public.requisitions add column if not exists deletion_reason text;

create or replace function public.owner_delete_test_record(p_type text,p_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,private
as $$
declare r text;
begin
 select role into r from public.profiles where id=auth.uid() and active=true;
 if r is distinct from 'owner' then raise exception 'Owner only' using errcode='42501'; end if;
 case lower(p_type)
 when 'order' then
   delete from notifications where reference_id=p_id;
   delete from email_messages where reference_id=p_id;
   delete from inventory_consumptions where order_id=p_id;
   delete from orders where id=p_id;
 when 'booking' then
   delete from notifications where reference_id=p_id;
   delete from email_messages where reference_id=p_id;
   delete from inventory_consumptions where order_id in (select id from orders where booking_id=p_id);
   delete from orders where booking_id=p_id;
   delete from swimming_sessions where booking_id=p_id;
   delete from booking_components where booking_id=p_id;
   delete from bookings where id=p_id;
 when 'inquiry' then
   delete from notifications where reference_id=p_id;
   delete from email_messages where reference_id=p_id;
   delete from inquiries where id=p_id;
 when 'purchase_order' then
   delete from purchase_order_items where purchase_order_id=p_id;
   delete from purchase_orders where id=p_id;
 when 'stock_movement' then delete from stock_movements where id=p_id;
 when 'menu_recipe' then delete from menu_item_recipes where id=p_id;
 when 'review' then delete from reviews where id=p_id;
 when 'gallery_item' then delete from gallery_items where id=p_id;
 when 'media' then delete from media where id=p_id;
 when 'announcement' then delete from announcements where id=p_id;
 when 'service_log' then delete from service_logs where id=p_id;
 when 'staff_task' then delete from staff_tasks where id=p_id;
 when 'daily_count' then delete from inventory_daily_counts where id=p_id;
 when 'notification' then delete from notifications where id=p_id;
 when 'email_message' then delete from email_messages where id=p_id;
 when 'requisition' then
   delete from purchase_order_items where purchase_order_id in (select id from purchase_orders where requisition_id=p_id);
   delete from purchase_orders where requisition_id=p_id;
   delete from requisition_version_items where version_id in (select id from requisition_versions where requisition_id=p_id);
   delete from requisition_versions where requisition_id=p_id;
   delete from requisition_items where requisition_id=p_id;
   update requisitions set deleted_at=coalesce(deleted_at,now()), deleted_by=auth.uid(), deletion_reason='Owner test cleanup; immutable approval audit retained.', notes=null, updated_at=now() where id=p_id;
   if not found then raise exception 'Requisition not found.'; end if;
 when 'team_position' then
   if exists(select 1 from profiles where position_id=p_id) then
     raise exception 'Position is assigned to a staff profile; remove the assignment first';
   end if;
   delete from team_positions where id=p_id;
 else raise exception 'Unsupported test record type';
 end case;
 return true;
end $$;

create index if not exists requisitions_active_org_status_idx
  on public.requisitions(organization_id,status) where deleted_at is null;

drop policy if exists requisitions_select on public.requisitions;
create policy requisitions_select on public.requisitions for select to authenticated using (
  organization_id=public.current_organization_id() and deleted_at is null and (
    public.has_permission('requisitions.view') or public.has_permission('requisitions.create') or
    public.has_permission('requisitions.approve.manager') or public.has_permission('requisitions.approve.gm') or
    public.has_permission('requisitions.approve.ceo')
  )
);
