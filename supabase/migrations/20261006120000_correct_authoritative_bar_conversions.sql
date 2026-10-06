-- Correct authoritative bar conversions found during live verification.
-- 30 ml is one standard spirit shot; a 750 ml baseline bottle therefore
-- yields 25 shots. The Focas 5L glass rule remains the 250 ml / 20-glass rule.
-- Remove the legacy generic 150 ml wine-glass rule so it cannot override
-- the Focas-specific 250 ml service rule.

begin;

update public.inventory_recipe_rules
set input_quantity=750,
    input_unit='ml',
    output_quantity=25,
    output_unit='shot',
    notes='750 ml baseline bottle / 30 ml standard shot = 25 shots. One shot consumes 0.04 bottle.'
where name='Spirits 750ml shot';

delete from public.inventory_recipe_rules
where name='Wine glass volume';

commit;