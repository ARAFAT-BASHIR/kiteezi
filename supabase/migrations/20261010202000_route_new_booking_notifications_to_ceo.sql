-- New bookings are first reviewed by the CEO. Keep order/review notifications routed as before.
create or replace function private.create_admin_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  target record;
  n_type text;
  n_title text;
  n_message text;
  ref_type text;
  ref_id uuid;
begin
  if tg_table_name = 'orders' and tg_op = 'INSERT' then
    n_type := 'new_order';
    n_title := 'New order received';
    n_message := 'A new order has been placed.';
    ref_type := 'order';
    ref_id := new.id;
  elsif tg_table_name = 'bookings' and tg_op = 'INSERT' then
    n_type := 'new_booking';
    n_title := 'New booking awaiting CEO review';
    n_message := 'A new booking has been submitted and is waiting for CEO approval.';
    ref_type := 'booking';
    ref_id := new.id;
  elsif tg_table_name = 'reviews' and tg_op = 'INSERT' then
    n_type := 'new_review';
    n_title := 'New review received';
    n_message := 'A new customer review is waiting for moderation.';
    ref_type := 'review';
    ref_id := new.id;
  else
    return new;
  end if;

  if tg_table_name = 'bookings' then
    for target in
      select p.id
      from public.profiles p
      where p.active = true and p.role in ('owner', 'ceo')
    loop
      insert into public.notifications(recipient_user_id, type, title, message, reference_type, reference_id)
      values(target.id, n_type, n_title, n_message, ref_type, ref_id);
    end loop;
  else
    for target in
      select p.id
      from public.profiles p
      where p.active = true and p.role in ('owner', 'general_manager')
    loop
      insert into public.notifications(recipient_user_id, type, title, message, reference_type, reference_id)
      values(target.id, n_type, n_title, n_message, ref_type, ref_id);
    end loop;
  end if;

  return new;
end
$function$;
