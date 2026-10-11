-- Require an active staff profile and action-specific permissions for booking updates.
-- CEO approval and Manager confirmation remain exclusive to their dedicated RPCs.

create or replace function public.admin_update_booking(p_booking_id uuid, p_status text default null, p_payment_status text default null)
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

  if p_status is null and p_payment_status is null then
    raise exception 'No booking change supplied.';
  end if;

  select role into v_role
  from public.profiles
  where id = v_uid and active = true;

  if v_role is null then
    raise exception 'An active staff profile is required.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'Booking not found.';
  end if;

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

    if p_status = 'completed' then
      if not public.has_permission('bookings.complete') then
        raise exception 'You are not permitted to complete bookings.';
      end if;
    elsif p_status = 'pending' then
      if not public.has_permission('bookings.manage') then
        raise exception 'You are not permitted to change booking status.';
      end if;
    else
      raise exception 'Invalid booking status.';
    end if;

    if p_status = 'completed' and v_booking.status <> 'confirmed' then
      raise exception 'Only confirmed bookings can be completed.';
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
