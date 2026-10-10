-- Ensure the head coach can read sports service records without cashier/order-management access.
begin;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id
from public.roles r
join public.permissions p on p.code='orders.department.sports'
where r.name='head_coach'
on conflict do nothing;
commit;
