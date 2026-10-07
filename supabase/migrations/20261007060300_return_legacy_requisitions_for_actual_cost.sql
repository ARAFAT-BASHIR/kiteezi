-- Legacy requisitions that were already manager-approved before actual-cost capture existed
-- are returned to the Manager stage so the mandatory actual-cost rule is applied consistently.
update public.requisitions r
set status='manager_pending', manager_approved_at=null, updated_at=now()
where r.status='gm_pending'
  and r.created_at < timestamptz '2026-10-07 06:00:00+00'
  and exists (
    select 1 from public.requisition_items i
    where i.requisition_id=r.id and coalesce(i.actual_unit_price,0)<=0
  );