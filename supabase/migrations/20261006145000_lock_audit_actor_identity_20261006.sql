drop policy if exists "Active staff can append audit logs" on public.audit_logs;
drop policy if exists "Active staff can append own audit logs" on public.audit_logs;
drop policy if exists "Owner full access" on public.audit_logs;
drop policy if exists "Active staff can read audit logs" on public.audit_logs;
create policy "Active staff can append own audit logs" on public.audit_logs for insert to authenticated with check (private.is_active_staff() and (actor_id is null or actor_id=auth.uid()));
create policy "Active staff can read audit logs" on public.audit_logs for select to authenticated using (private.is_active_staff());