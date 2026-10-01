-- OPTIONAL, NON-DESTRUCTIVE SEEDS.
-- Do not replace your existing schema. Run only if these records are missing.
insert into services(name,category,description,price,duration_minutes)
values ('Football','sports','Football field/group booking; price configurable',0,60)
on conflict (name) do nothing;

insert into sports(name,description,active)
values
 ('Football','Football field/group sessions',true),
 ('Basketball','Basketball court/group sessions',true)
on conflict (name) do nothing;
