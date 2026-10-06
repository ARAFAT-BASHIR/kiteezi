-- Populate the visible menu_item_recipes table from the authoritative business rules.
-- The same recipe rows are used by inventory finalization, while shared-pool
-- metadata remains available for dynamic allocation such as cocktails.

begin;

insert into public.menu_item_recipes (menu_item_id,inventory_item_id,quantity,recipe_unit,stock_units_per_recipe_unit)
select r.menu_item_id,r.inventory_item_id,r.fraction_per_menu_unit,lower(coalesce(i.unit,'stock')),1
from public.shared_pool_menu_rules r join public.inventory_items i on i.id=r.inventory_item_id
where r.active=true and r.fraction_per_menu_unit is not null
on conflict (menu_item_id,inventory_item_id) do update set quantity=excluded.quantity,recipe_unit=excluded.recipe_unit,stock_units_per_recipe_unit=excluded.stock_units_per_recipe_unit;

-- Explicit business-rule recipes are populated by the live reconciliation
-- migration applied alongside this file.

commit;