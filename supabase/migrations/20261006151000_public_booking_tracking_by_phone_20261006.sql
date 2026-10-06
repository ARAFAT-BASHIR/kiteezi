create or replace function public.get_public_bookings_by_phone(p_phone text)
returns table(booking_id uuid,booking_date date,start_time time,status text,payment_status text,total numeric,service_name text,created_at timestamptz)
language sql security definer
set search_path=public,private,pg_catalog,pg_temp
as $$
select b.id,b.booking_date,b.start_time,b.status,b.payment_status,b.total,s.name,b.created_at
from public.bookings b
left join public.customers c on c.id=b.customer_id
left join public.services s on s.id=b.service_id
where private.normalize_phone(c.phone)=private.normalize_phone(p_phone)
order by b.created_at desc
limit 10;
$$;
revoke all on function public.get_public_bookings_by_phone(text) from public;
grant execute on function public.get_public_bookings_by_phone(text) to anon,authenticated;