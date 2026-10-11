-- Public booking tracking must not reveal bookings entered through private staff workflows.
-- Public tracking/cancellation is designed for website-originated bookings.
create or replace function public.get_public_booking_status(p_booking_id uuid, p_phone text)
returns table(booking_id uuid, status text, payment_status text, total numeric, total_on_request boolean, booking_date date, start_time time without time zone, created_at timestamp with time zone)
language sql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
  select b.id, b.status, b.payment_status, b.total, b.total_on_request,
         b.booking_date, b.start_time, b.created_at
  from public.bookings b
  join public.customers c on c.id = b.customer_id
  where b.id = p_booking_id
    and c.phone = private.normalize_phone(p_phone)
    and b.source = 'website'
  limit 1;
$function$;

create or replace function public.get_public_bookings_by_phone(p_phone text)
returns table(booking_id uuid, booking_date date, start_time time without time zone, status text, payment_status text, total numeric, service_name text, created_at timestamp with time zone, customer_confirmation_message text)
language sql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
  select b.id, b.booking_date, b.start_time, b.status, b.payment_status,
         b.total, s.name, b.created_at, b.customer_confirmation_message
  from public.bookings b
  join public.customers c on c.id = b.customer_id
  left join public.services s on s.id = b.service_id
  where private.normalize_phone(c.phone) = private.normalize_phone(p_phone)
    and b.source = 'website'
  order by b.created_at desc
  limit 10;
$function$;

revoke all on function public.get_public_booking_status(uuid, text) from public;
grant execute on function public.get_public_booking_status(uuid, text) to anon, authenticated;
revoke all on function public.get_public_bookings_by_phone(text) from public;
grant execute on function public.get_public_bookings_by_phone(text) to anon, authenticated;
