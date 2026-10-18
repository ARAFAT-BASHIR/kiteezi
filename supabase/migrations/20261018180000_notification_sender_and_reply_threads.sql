-- Add sender attribution and thread identity to existing Kiteezi notifications.
alter table public.notifications
  add column if not exists sender_user_id uuid,
  add column if not exists thread_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'notifications_sender_user_id_fkey'
      and conrelid = 'public.notifications'::regclass
  ) then
    alter table public.notifications
      add constraint notifications_sender_user_id_fkey
      foreign key (sender_user_id) references public.profiles(id) on delete set null;
  end if;
end $$;

update public.notifications set thread_id = id where thread_id is null;
alter table public.notifications alter column thread_id set not null;

create or replace function private.ensure_notification_thread_id()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  if new.id is null then new.id := gen_random_uuid(); end if;
  if new.thread_id is null then new.thread_id := new.id; end if;
  return new;
end;
$$;

drop trigger if exists trg_ensure_notification_thread_id on public.notifications;
create trigger trg_ensure_notification_thread_id
before insert on public.notifications
for each row execute function private.ensure_notification_thread_id();
revoke all on function private.ensure_notification_thread_id() from public, anon, authenticated;

drop policy if exists "Users can read their notifications" on public.notifications;
drop policy if exists "Users can read notification conversations" on public.notifications;
create policy "Users can read notification conversations"
on public.notifications for select to authenticated
using ((select auth.uid()) = recipient_user_id or (select auth.uid()) = sender_user_id);

-- Attribute human order-status changes to the staff member who performed them.
create or replace function public.notify_staff_order_status()
returns trigger language plpgsql security definer
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
  v_sender uuid := auth.uid();
begin
  if new.source is distinct from 'pos' or new.created_by is null then return new; end if;
  if v_status is distinct from v_old_status then
    v_title := null; v_message := null;
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
        (recipient_user_id, sender_user_id, type, title, message, reference_type, reference_id, is_read, created_at)
      values
        (new.created_by, case when v_sender is distinct from new.created_by then v_sender else null end,
         'order', v_title, v_message, 'order', new.id, false, now())
      on conflict do nothing;
    end if;
  end if;
  if v_payment is distinct from v_old_payment
     and v_payment in ('paid', 'complete', 'completed')
     and v_old_payment not in ('paid', 'complete', 'completed') then
    insert into public.notifications
      (recipient_user_id, sender_user_id, type, title, message, reference_type, reference_id, is_read, created_at)
    values
      (new.created_by, case when v_sender is distinct from new.created_by then v_sender else null end,
       'order_payment', 'Order paid',
       'Payment for order #' || v_order_label || ' has been marked as received.',
       'order', new.id, false, now())
    on conflict do nothing;
  end if;
  return new;
end;
$function$;
revoke all on function public.notify_staff_order_status() from public, anon, authenticated;
