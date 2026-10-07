-- Production audit cleanup:
-- * cover the remaining foreign keys flagged by the performance advisor
-- * consolidate push subscription RLS into one policy per operation
-- * avoid per-row auth.uid()/helper evaluation in RLS
-- * explicitly deny client access to the server-side push configuration table

create index if not exists idx_credit_notes_created_by on public.credit_notes(created_by);
create index if not exists idx_journal_entries_created_by on public.journal_entries(created_by);
create index if not exists idx_journal_entries_reversed_entry_id on public.journal_entries(reversed_entry_id);
create index if not exists idx_journal_entry_lines_journal_entry_id on public.journal_entry_lines(journal_entry_id);
create index if not exists idx_payroll_runs_created_by on public.payroll_runs(created_by);
create index if not exists idx_receipts_created_by on public.receipts(created_by);
create index if not exists idx_staff_tasks_accepted_by on public.staff_tasks(accepted_by);
create index if not exists idx_staff_tasks_rejected_by on public.staff_tasks(rejected_by);

drop policy if exists push_subscriptions_select on public.push_subscriptions;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
drop policy if exists push_subscriptions_write on public.push_subscriptions;

create policy push_subscriptions_select_own on public.push_subscriptions
for select to authenticated
using (
  user_id = (select auth.uid())
  and organization_id = (select public.current_organization_id())
);

create policy push_subscriptions_insert_own on public.push_subscriptions
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and organization_id = (select public.current_organization_id())
);

create policy push_subscriptions_update_own on public.push_subscriptions
for update to authenticated
using (
  user_id = (select auth.uid())
  and organization_id = (select public.current_organization_id())
)
with check (
  user_id = (select auth.uid())
  and organization_id = (select public.current_organization_id())
);

create policy push_subscriptions_delete_own on public.push_subscriptions
for delete to authenticated
using (
  user_id = (select auth.uid())
  and organization_id = (select public.current_organization_id())
);

drop policy if exists "Active staff can append own audit logs" on public.audit_logs;
create policy "Active staff can append own audit logs" on public.audit_logs
for insert to authenticated
with check (
  (select private.is_active_staff())
  and ((actor_id is null) or (actor_id = (select auth.uid())))
);

create policy "push_config_no_client_access" on public.push_config
as restrictive
for all to anon, authenticated
using (false)
with check (false);
