-- Prevent direct table/RPC updates from bypassing CEO booking approval and Manager confirmation.
create or replace function private.enforce_booking_approval_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = auth.uid()
    and p.active = true;

  if new.ceo_approved_at is distinct from old.ceo_approved_at
     or new.ceo_approved_by is distinct from old.ceo_approved_by then
    if coalesce(v_role, '') not in ('ceo', 'owner') then
      raise exception 'Only the CEO can approve a booking.';
    end if;
    if new.ceo_approved_at is not null and new.ceo_approved_by is distinct from auth.uid() then
      raise exception 'CEO approval must be recorded against the approving account.';
    end if;
  end if;

  if new.manager_approved_at is distinct from old.manager_approved_at
     or new.manager_approved_by is distinct from old.manager_approved_by then
    if coalesce(v_role, '') not in ('manager', 'owner') then
      raise exception 'Only the Manager can confirm a CEO-approved booking.';
    end if;
    if new.ceo_approved_at is null then
      raise exception 'This booking must be approved by the CEO before Manager confirmation.';
    end if;
    if new.manager_approved_at is not null and new.manager_approved_by is distinct from auth.uid() then
      raise exception 'Manager confirmation must be recorded against the confirming account.';
    end if;
  end if;

  if old.status in ('completed', 'cancelled') and new.status is distinct from old.status then
    raise exception 'Completed or cancelled bookings cannot be reopened.';
  end if;

  if new.status = 'pending' and old.status is distinct from new.status then
    raise exception 'A booking cannot be returned to pending after processing has started.';
  end if;

  if new.status = 'confirmed' and old.status is distinct from new.status then
    if new.ceo_approved_at is null or new.manager_approved_at is null then
      raise exception 'A booking must pass CEO approval and Manager confirmation before it can be confirmed.';
    end if;
    if new.manager_approved_by is distinct from auth.uid() then
      raise exception 'Only the Manager completing this approval step can confirm the booking.';
    end if;
  end if;

  if new.status = 'completed' and old.status is distinct from new.status and old.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be completed.';
  end if;

  if new.status = 'cancelled' and old.status is distinct from new.status then
    if old.status in ('completed', 'cancelled') then
      raise exception 'This booking cannot be cancelled.';
    end if;
    if nullif(trim(coalesce(new.cancellation_reason, '')), '') is null then
      raise exception 'A cancellation reason is required.';
    end if;
  end if;

  return new;
end
$function$;

drop trigger if exists trg_enforce_booking_approval_workflow on public.bookings;
create trigger trg_enforce_booking_approval_workflow
before update on public.bookings
for each row execute function private.enforce_booking_approval_workflow();

-- Keep the general-purpose status RPC from presenting a direct confirmation shortcut.
create or replace function public.admin_update_booking(
  p_booking_id uuid,
  p_status text default null,
  p_payment_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_uid uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_role text;
  v_school boolean;
begin
  if v_uid is null then
    raise exception 'Authentication required.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

  select role into v_role
  from public.profiles
  where id = v_uid and active = true;

  v_school := v_booking.booking_type = 'school_swimming'
    or exists (
      select 1 from public.services s
      where s.id = v_booking.service_id
        and lower(s.name) like '%school swimming%'
    );

  if v_role = 'head_swimming_coach' and not v_school then
    raise exception 'Head Swimming Coach may only operate School Swimming bookings.';
  end if;

  if p_status is not null then
    if p_status = 'confirmed' then
      raise exception 'Use CEO approval followed by Manager confirmation to confirm a booking.';
    end if;
    if p_status = 'cancelled' then
      raise exception 'Use the Cancel booking action so a cancellation reason is recorded.';
    end if;
    if p_status = 'completed' and not public.has_permission('bookings.complete') then
      raise exception 'You are not permitted to complete bookings.';
    end if;
    if p_status = 'cancelled' and not public.has_permission('bookings.cancel') then
      raise exception 'You are not permitted to cancel bookings.';
    end if;
    if p_status not in ('pending', 'completed', 'cancelled') then
      raise exception 'Invalid booking status.';
    end if;
    if p_status = 'completed' and v_booking.status <> 'confirmed' then
      raise exception 'Only confirmed bookings can be completed.';
    end if;
    if p_status = 'cancelled' and v_booking.status in ('completed', 'cancelled') then
      raise exception 'This booking cannot be cancelled.';
    end if;
    update public.bookings set status = p_status where id = p_booking_id;
  end if;

  if p_payment_status is not null then
    if p_payment_status not in ('unpaid', 'paid') then
      raise exception 'Invalid payment status.';
    end if;
    if not public.has_permission('bookings.pay') then
      raise exception 'You are not permitted to mark bookings paid.';
    end if;
    if v_booking.status = 'cancelled' then
      raise exception 'Cancelled bookings cannot be paid.';
    end if;
    update public.bookings set payment_status = p_payment_status where id = p_booking_id;
  end if;

  return jsonb_build_object(
    'id', p_booking_id,
    'status', (select status from public.bookings where id = p_booking_id),
    'payment_status', (select payment_status from public.bookings where id = p_booking_id)
  );
end
$function$;

revoke all on function public.admin_update_booking(uuid, text, text) from public, anon;
grant execute on function public.admin_update_booking(uuid, text, text) to authenticated;
