-- Add the explicit Espresso recipe against the actual current menu name.
-- Earlier reconciliation targeted a generic "espresso" name, but the live
-- menu uses "Espresso (Cup)". Do not create recipes for absent menu items.

insert into public.menu_item_recipes
  (menu_item_id, inventory_item_id, quantity, recipe_unit, stock_units_per_recipe_unit)
select m.id, i.id, 20, 'g', 1
from public.menu_items m
cross join public.inventory_items i
where lower(trim(m.name))='espresso (cup)'
  and lower(trim(i.name))='coffee'
  and not exists (
    select 1 from public.menu_item_recipes x
    where x.menu_item_id=m.id and x.inventory_item_id=i.id
  );