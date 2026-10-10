-- Prevent direct inserts from creating already-confirmed bookings or forged approval records.
-- Public booking submission must begin pending; approvals happen through the explicit RPC sequence.

create or replace function private.enforce_booking_approval_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_action text := coalesce(current_setting('app.booking_approval_action', true), '');
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending'
       or new.ceo_approved_at is not null
       or new.ceo_approved_by is not null
       or new.manager_approved_at is not null
       or new.manager_approved_by is not null then
      raise exception 'New bookings must start pending and cannot contain approval records.';
    end if;
    return new;
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_uid and p.active = true;

  if new.ceo_approved_at is distinct from old.ceo_approved_at
     or new.ceo_approved_by is distinct from old.ceo_approved_by then
    if v_action <> 'ceo'
       or coalesce(v_role, '') not in ('ceo', 'owner')
       or not public.has_permission('bookings.confirm') then
      raise exception 'Only the CEO approval action can record CEO approval.';
    end if;
    if old.ceo_approved_at is not null or old.ceo_approved_by is not null then
      raise exception 'CEO approval has already been recorded and cannot be changed.';
    end if;
    if new.ceo_approved_at is null or new.ceo_approved_by is distinct from v_uid then
      raise exception 'CEO approval must be recorded against the approving account.';
    end if;
    if new.manager_approved_at is distinct from old.manager_approved_at
       or new.manager_approved_by is distinct from old.manager_approved_by
       or new.status is distinct from old.status then
      raise exception 'CEO approval and Manager confirmation must be separate steps.';
    end if;
  end if;

  if new.manager_approved_at is distinct from old.manager_approved_at
     or new.manager_approved_by is distinct from old.manager_approved_by then
    if v_action <> 'manager'
       or coalesce(v_role, '') not in ('manager', 'owner')
       or not public.has_permission('bookings.confirm') then
      raise exception 'Only the Manager confirmation action can record Manager approval.';
    end if;
    if old.ceo_approved_at is null or old.ceo_approved_by is null then
      raise exception 'The CEO must approve the booking in a prior step.';
    end if;
    if old.manager_approved_at is not null or old.manager_approved_by is not null then
      raise exception 'Manager confirmation has already been recorded.';
    end if;
    if new.manager_approved_at is null or new.manager_approved_by is distinct from v_uid then
      raise exception 'Manager confirmation must be recorded against the confirming account.';
    end if;
    if new.status is distinct from 'confirmed' then
      raise exception 'Manager confirmation must confirm the booking.';
    end if;
  end if;

  if new.status = 'confirmed' and old.status is distinct from new.status then
    if old.status <> 'pending'
       or v_action <> 'manager'
       or old.ceo_approved_at is null
       or old.ceo_approved_by is null
       or new.manager_approved_at is null
       or new.manager_approved_by is distinct from v_uid then
      raise exception 'A booking must pass CEO approval first, then Manager confirmation.';
    end if;
  end if;

  if old.status in ('completed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Completed or cancelled bookings cannot be reopened.';
  end if;

  if new.status = 'pending' and old.status is distinct from new.status then
    raise exception 'A booking cannot be returned to pending after processing has started.';
  end if;

  if new.status = 'completed' and old.status is distinct from new.status and old.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be completed.';
  end if;

  if new.status = 'cancelled' and old.status is distinct from new.status
     and old.status in ('completed', 'cancelled') then
    raise exception 'This booking cannot be cancelled.';
  end if;

  return new;
end
$function$;

drop trigger if exists trg_enforce_booking_approval_workflow on public.bookings;
create trigger trg_enforce_booking_approval_workflow
before insert or update on public.bookings
for each row execute function private.enforce_booking_approval_workflow();
