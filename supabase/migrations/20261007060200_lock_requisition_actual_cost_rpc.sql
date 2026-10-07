revoke execute on function public.approve_requisition(uuid,text,jsonb,text,jsonb) from public, anon;
grant execute on function public.approve_requisition(uuid,text,jsonb,text,jsonb) to authenticated;