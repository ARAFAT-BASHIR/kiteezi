drop policy if exists "Staff can read non-owner audit logs" on public.audit_logs;
create policy "Authorized staff can read non-owner audit logs"
on public.audit_logs
for select
to authenticated
using (
  private.is_owner()
  or (
    private.has_permission('reports.view')
    and coalesce(actor_role, '') <> 'owner'
  )
);
