-- Make department reference-record permissions assignable in the existing
-- Roles & Permissions screen. Department permissions are read-only; order creation,
-- confirmation, payment and reporting permissions remain separate.
begin;

insert into public.permissions(code,description)
values
  ('orders.department.swimming','Read confirmed swimming service records'),
  ('orders.department.sports','Read confirmed sports service records'),
  ('orders.department.photography','Read confirmed photography service records'),
  ('orders.department.buffet','Read confirmed buffet and event service records'),
  ('orders.department.other','Read other authorized record-only service records')
on conflict (code) do update set description=excluded.description;

-- Assign the least-privilege read scopes to the matching operational roles.
-- The rows contain only SELECT permission; the POS record table's write policy
-- remains restricted to the owner or orders.manage.
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id
from public.roles r
join public.permissions p on p.code = case
  when r.name in ('swimming_manager','head_swimming_coach','swimming_coach','lifeguard') then 'orders.department.swimming'
  when r.name in ('events_coordinator') then 'orders.department.buffet'
  when r.name in ('media_manager','marketing_social_media') then 'orders.department.photography'
  when r.name in ('manager','general_manager','ceo') then 'orders.department.sports'
  else null
end
where r.name in ('swimming_manager','head_swimming_coach','swimming_coach','lifeguard','events_coordinator','media_manager','marketing_social_media','manager','general_manager','ceo')
on conflict do nothing;

commit;
