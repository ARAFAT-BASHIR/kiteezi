-- Harden requisition/PO security and align cocktail confirmation with the one-fruit rule.

revoke execute on function public.approve_requisition(uuid,text,jsonb,text) from anon;
revoke execute on function public.create_requisition(jsonb,text) from anon;
revoke execute on function public.create_role_notification(text,text,text,text,text,uuid) from anon;
revoke execute on function public.current_organization_id() from anon;
revoke execute on function public.record_service_log(uuid,numeric) from anon;
revoke execute on function public.guard_purchase_order_insert() from anon,authenticated;
revoke execute on function public.guard_purchase_order_update() from public;
revoke execute on function public.block_approval_audit_mutation() from public;

create or replace function public.guard_purchase_order_update()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin
  if old.requisition_id is not null and new.requisition_id is distinct from old.requisition_id then raise exception 'Purchase order source requisition cannot be changed.'; end if;
  if old.requisition_version_id is not null and new.requisition_version_id is distinct from old.requisition_version_id then raise exception 'Purchase order source version cannot be changed.'; end if;
  return new;
end $$;

create or replace function public.block_approval_audit_mutation()
returns trigger language plpgsql set search_path=public,pg_catalog as $$
begin raise exception 'Approval audit history is immutable.'; end $$;

drop policy if exists organizations_current_member_select on public.organizations;
create policy organizations_current_member_select on public.organizations
for select to authenticated using (id=public.current_organization_id());

-- The deployed confirm_order_inventory function now accepts one or more cocktail fruits.
-- The authoritative function remains deployed in Supabase; this marker migration documents the rule.
