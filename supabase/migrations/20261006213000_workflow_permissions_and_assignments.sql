-- Workflow permissions and moderation controls
drop function if exists public.set_order_station_status(uuid,uuid,text);

drop policy if exists "Staff update reviews by permission" on public.reviews;
create policy "Staff update reviews by permission" on public.reviews for update to authenticated using (private.has_permission('reviews.moderate')) with check (private.has_permission('reviews.moderate'));

alter table public.staff_tasks add column if not exists rejection_reason text, add column if not exists accepted_at timestamptz, add column if not exists accepted_by uuid references auth.users(id), add column if not exists rejected_at timestamptz, add column if not exists rejected_by uuid references auth.users(id);

create or replace function public.accept_staff_task(p_task_id uuid) returns boolean language plpgsql security definer set search_path=public,private,pg_catalog,pg_temp as $$ begin if not exists(select 1 from public.staff_tasks where id=p_task_id and assigned_to=auth.uid()) then raise exception 'This task is not assigned to you'; end if; update public.staff_tasks set status='accepted',accepted_at=coalesce(accepted_at,now()),accepted_by=auth.uid(),rejection_reason=null,rejected_at=null,rejected_by=null where id=p_task_id; return true; end $$;
create or replace function public.reject_staff_task(p_task_id uuid,p_reason text) returns boolean language plpgsql security definer set search_path=public,private,pg_catalog,pg_temp as $$ begin if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'A rejection reason is required'; end if; if not exists(select 1 from public.staff_tasks where id=p_task_id and assigned_to=auth.uid()) then raise exception 'This task is not assigned to you'; end if; update public.staff_tasks set status='rejected',rejection_reason=trim(p_reason),rejected_at=now(),rejected_by=auth.uid() where id=p_task_id; return true; end $$;
revoke all on function public.accept_staff_task(uuid) from public,anon;
grant execute on function public.accept_staff_task(uuid) to authenticated,service_role;
revoke all on function public.reject_staff_task(uuid,text) from public,anon;
grant execute on function public.reject_staff_task(uuid,text) to authenticated,service_role;
