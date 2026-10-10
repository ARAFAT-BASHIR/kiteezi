-- Enforce a two-step booking approval: CEO approval, then Manager confirmation.
-- Approval fields can only be changed by the corresponding authenticated RPC step.

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
  if tg_op <> 'UPDATE' then
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

create or replace function public.ceo_approve_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_uid uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_name text;
begin
  if v_uid is null
     or not public.has_permission('bookings.confirm')
     or (select role from public.profiles where id = v_uid and active = true) not in ('ceo', 'owner') then
    raise exception 'Only the CEO can approve bookings at this stage.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.status <> 'pending' then raise exception 'Only pending bookings can receive CEO approval.'; end if;
  if v_booking.ceo_approved_at is not null or v_booking.ceo_approved_by is not null then
    raise exception 'This booking has already received CEO approval.';
  end if;
  if v_booking.manager_approved_at is not null or v_booking.manager_approved_by is not null then
    raise exception 'Manager confirmation cannot precede CEO approval.';
  end if;

  select name into v_name from public.customers where id = v_booking.customer_id;
  perform set_config('app.booking_approval_action', 'ceo', true);

  update public.bookings
  set ceo_approved_at = now(),
      ceo_approved_by = v_uid,
      customer_confirmation_message = 'Your booking has been approved by the CEO and is awaiting final Manager confirmation.'
  where id = p_booking_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at,actor_name,actor_role,occurred_from,occurred_to)
  select v_uid,'booking_ceo_approved','booking',p_booking_id,jsonb_build_object('customer',v_name),now(),p.full_name,p.role,now(),now()
  from public.profiles p where p.id = v_uid;

  perform public.create_role_notification(
    'manager','booking_ceo_approved','Booking awaiting Manager confirmation',
    'A booking has received CEO approval and now needs Manager confirmation before the customer is notified.',
    'booking',p_booking_id
  );

  return jsonb_build_object('id',p_booking_id,'status','pending','stage','manager');
end
$function$;

create or replace function public.manager_confirm_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_uid uuid := auth.uid();
  v_booking public.bookings%rowtype;
  v_message text;
begin
  if v_uid is null
     or not public.has_permission('bookings.confirm')
     or (select role from public.profiles where id = v_uid and active = true) not in ('manager', 'owner') then
    raise exception 'Only the Manager can finalize a CEO-approved booking.';
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.status <> 'pending'
     or v_booking.ceo_approved_at is null
     or v_booking.ceo_approved_by is null then
    raise exception 'This booking must be approved by the CEO before Manager confirmation.';
  end if;
  if v_booking.manager_approved_at is not null or v_booking.manager_approved_by is not null then
    raise exception 'This booking has already received Manager confirmation.';
  end if;

  v_message := 'Hello ' || coalesce((select name from public.customers where id = v_booking.customer_id), 'Customer')
    || ', your Kiteezi Recreational Center booking has been confirmed.';

  perform set_config('app.booking_approval_action', 'manager', true);
  update public.bookings
  set status = 'confirmed',
      manager_approved_at = now(),
      manager_approved_by = v_uid,
      customer_confirmation_message = v_message
  where id = p_booking_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at,actor_name,actor_role,occurred_from,occurred_to)
  select v_uid,'booking_manager_confirmed','booking',p_booking_id,jsonb_build_object('customer_message',v_message),now(),p.full_name,p.role,now(),now()
  from public.profiles p where p.id = v_uid;

  return jsonb_build_object('id',p_booking_id,'status','confirmed','customer_message',v_message);
end
$function$;

revoke all on function public.ceo_approve_booking(uuid) from public, anon;
grant execute on function public.ceo_approve_booking(uuid) to authenticated;
revoke all on function public.manager_confirm_booking(uuid) from public, anon;
grant execute on function public.manager_confirm_booking(uuid) to authenticated;

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
