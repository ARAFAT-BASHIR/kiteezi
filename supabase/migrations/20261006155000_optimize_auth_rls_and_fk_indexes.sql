-- Production hardening applied to the live Supabase project.
-- Keeps intentional owner/staff RLS policies and intentional SECURITY DEFINER RPCs unchanged.
create index if not exists idx_gallery_items_approved_by on public.gallery_items(approved_by) where approved_by is not null;
create index if not exists profiles_organization_id_idx on public.profiles(organization_id);
create index if not exists idx_profiles_position_id on public.profiles(position_id) where position_id is not null;
create index if not exists idx_team_positions_department_active on public.team_positions(department,active);
drop index if exists public.uq_team_positions_staff_profile;

create index if not exists idx_push_subscriptions_organization_id on public.push_subscriptions(organization_id);
create index if not exists idx_requisition_items_inventory_item_id on public.requisition_items(inventory_item_id);
create index if not exists idx_requisition_version_items_inventory_item_id on public.requisition_version_items(inventory_item_id);
create index if not exists idx_requisition_version_items_version_id on public.requisition_version_items(version_id);
create index if not exists idx_requisition_versions_created_by on public.requisition_versions(created_by);
create index if not exists idx_requisitions_created_by on public.requisitions(created_by);
create index if not exists idx_requisitions_requester_id on public.requisitions(requester_id);
create index if not exists idx_service_logs_item_id on public.service_logs(item_id);
create index if not exists idx_service_logs_staff_id on public.service_logs(staff_id);

drop index if exists public.idx_profiles_organization_id;

drop policy if exists "Assigned swimming coach can read own sessions" on public.swimming_sessions;
create policy "Assigned swimming coach can read own sessions" on public.swimming_sessions for select to authenticated using ((select private.has_permission('swimming.assigned'::text)) and (coach_id = (select auth.uid())));

drop policy if exists "Assigned swimming coach can update own sessions" on public.swimming_sessions;
create policy "Assigned swimming coach can update own sessions" on public.swimming_sessions for update to authenticated using ((select private.has_permission('swimming.assigned'::text)) and (coach_id = (select auth.uid()))) with check ((select private.has_permission('swimming.assigned'::text)) and (coach_id = (select auth.uid())));

drop policy if exists service_logs_insert on public.service_logs;
create policy service_logs_insert on public.service_logs for insert to authenticated with check ((organization_id = (select public.current_organization_id())) and (staff_id = (select auth.uid())) and (select private.has_permission('service_logs.create'::text)));

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using ((organization_id = (select public.current_organization_id())) and (user_id = (select auth.uid())));

drop policy if exists push_subscriptions_write on public.push_subscriptions;
create policy push_subscriptions_write on public.push_subscriptions for all to authenticated using ((organization_id = (select public.current_organization_id())) and (user_id = (select auth.uid()))) with check ((organization_id = (select public.current_organization_id())) and (user_id = (select auth.uid())));
