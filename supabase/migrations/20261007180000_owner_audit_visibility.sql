-- Owner-authored audit activity is visible only to the owner.
drop policy if exists "Active staff can read audit logs" on public.audit_logs;
create policy "Staff can read non-owner audit logs"
on public.audit_logs
for select to authenticated
using (
  private.is_owner()
  or (private.is_active_staff() and coalesce(actor_role,'') <> 'owner')
);

drop policy if exists approval_audit_select on public.approval_audit_trail;
create policy approval_audit_select
on public.approval_audit_trail
for select to authenticated
using (
  organization_id = public.current_organization_id()
  and private.has_permission('requisitions.view')
  and (
    private.is_owner()
    or not exists (
      select 1 from public.profiles p
      where p.id = approval_audit_trail.approver_id
        and p.role = 'owner'
    )
  )
);
