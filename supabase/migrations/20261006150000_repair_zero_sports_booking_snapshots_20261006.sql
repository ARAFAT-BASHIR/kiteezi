-- Repair legacy sports booking price snapshots created before team pricing was correctly configured.
alter table public.booking_components disable trigger trg_booking_component_snapshot;
update public.booking_components bc
set unit_price=case when b.people<s.team_threshold then s.small_group_price else s.full_team_price end
from public.bookings b join public.services s on s.id=b.service_id
where bc.booking_id=b.id and bc.service_id=s.id
  and lower(s.name) in ('basketball','football')
  and bc.price_on_request=false and bc.unit_price=0;
alter table public.booking_components enable trigger trg_booking_component_snapshot;
update public.bookings b
set total=coalesce((select sum(line_total) from public.booking_components bc where bc.booking_id=b.id),0)
where b.service_id in (select id from public.services where lower(name) in ('basketball','football'))
  and b.total=0;
