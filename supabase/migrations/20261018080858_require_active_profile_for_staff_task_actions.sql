CREATE OR REPLACE FUNCTION public.accept_staff_task(p_task_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.active = true
  ) then
    raise exception 'An active staff account is required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.staff_tasks
    where id = p_task_id and assigned_to = auth.uid()
  ) then
    raise exception 'This task is not assigned to you' using errcode = '42501';
  end if;

  update public.staff_tasks
  set status = 'accepted', accepted_at = coalesce(accepted_at, now()), accepted_by = auth.uid(),
      rejection_reason = null, rejected_at = null, rejected_by = null
  where id = p_task_id;
  return true;
end
$function$;

CREATE OR REPLACE FUNCTION public.reject_staff_task(p_task_id uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'private', 'pg_catalog', 'pg_temp'
AS $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.active = true
  ) then
    raise exception 'An active staff account is required' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A rejection reason is required';
  end if;
  if not exists (
    select 1 from public.staff_tasks
    where id = p_task_id and assigned_to = auth.uid()
  ) then
    raise exception 'This task is not assigned to you' using errcode = '42501';
  end if;

  update public.staff_tasks
  set status = 'rejected', rejection_reason = trim(p_reason), rejected_at = now(), rejected_by = auth.uid()
  where id = p_task_id;
  return true;
end
$function$;
