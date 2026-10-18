-- Notify the staff member who placed a POS order about every key order/payment transition.
-- The existing notifications insert trigger also queues push delivery for subscribed devices.

create or replace function public.notify_staff_order_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_order_label text := upper(left(new.id::text, 8));
  v_status text := lower(coalesce(new.status, ''));
  v_old_status text := lower(coalesce(old.status, ''));
  v_payment text := lower(coalesce(new.payment_status, ''));
  v_old_payment text := lower(coalesce(old.payment_status, ''));
  v_title text;
  v_message text;
begin
  -- Only notify the authenticated staff member who created an admin/POS order.
  if new.source is distinct from 'pos' or new.created_by is null then
    return new;
  end if;

  -- Status transitions are notified once per actual change, including cancellation
  -- after confirmation (not only cancellation from pending/open).
  if v_status is distinct from v_old_status then
    v_title := null;
    v_message := null;

    if v_status = 'confirmed' then
      v_title := 'Order confirmed';
      v_message := 'Order #' || v_order_label || ' has been confirmed and sent to the required stations.';
    elsif v_status in ('cancelled', 'canceled') then
      v_title := 'Order cancelled';
      v_message := 'Order #' || v_order_label || ' has been cancelled.';
    elsif v_status in ('completed', 'complete', 'fulfilled') then
      v_title := 'Order completed';
      v_message := 'Order #' || v_order_label || ' has been completed.';
    end if;

    if v_title is not null then
      insert into public.notifications
        (recipient_user_id, type, title, message, reference_type, reference_id, is_read, created_at)
      values
        (new.created_by, 'order', v_title, v_message, 'order', new.id, false, now())
      on conflict do nothing;
    end if;
  end if;

  -- Payment is a separate field in Kiteezi. Notify when it first enters a paid state.
  if v_payment is distinct from v_old_payment
     and v_payment in ('paid', 'complete', 'completed')
     and v_old_payment not in ('paid', 'complete', 'completed') then
    insert into public.notifications
      (recipient_user_id, type, title, message, reference_type, reference_id, is_read, created_at)
    values
      (new.created_by, 'order_payment', 'Order paid',
       'Payment for order #' || v_order_label || ' has been marked as received.',
       'order', new.id, false, now())
    on conflict do nothing;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_notify_staff_order_status on public.orders;
create trigger trg_notify_staff_order_status
after update of status, payment_status on public.orders
for each row execute function public.notify_staff_order_status();

revoke all on function public.notify_staff_order_status() from public, anon, authenticated;
