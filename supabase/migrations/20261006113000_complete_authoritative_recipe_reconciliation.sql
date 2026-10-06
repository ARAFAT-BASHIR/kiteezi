-- 2026-10-06 authoritative recipe reconciliation
-- Complete the explicitly specified, non-ambiguous mappings without deleting
-- existing Admin configurations where the specification says to preserve them.

begin;

-- Exact conversion rules. These are stored centrally and are also used by
-- recipe rows below. Existing rows with the same rule name are replaced.
delete from public.inventory_recipe_rules
where name in (
  'Minced meat authoritative yield',
  'Nile perch authoritative yield',
  'Tilapia authoritative yield',
  'Rice authoritative yield',
  'Spirits 750ml shot',
  'Focas 5L wine glass',
  'Espresso authoritative dose',
  'Large milkshake authoritative dose',
  'Small milkshake authoritative dose',
  'African coffee authoritative dose',
  'African tea authoritative dose'
);

insert into public.inventory_recipe_rules
(name,rule_type,inventory_item_id,output_name,input_quantity,input_unit,output_quantity,output_unit,notes,active)
select * from (
values
('Minced meat authoritative yield','shared_pool',(select id from public.inventory_items where name='Minced meat'),'Samosa',1,'kg',40,'piece','1 kg minced meat produces 40 samosas.',true),
('Minced meat authoritative yield','shared_pool',(select id from public.inventory_items where name='Minced meat'),'Kebab',1,'kg',30,'portion','1 kg minced meat produces 30 kebab portions.',true),
('Minced meat authoritative yield','shared_pool',(select id from public.inventory_items where name='Minced meat'),'Chap',1,'kg',30,'portion','1 kg minced meat produces 30 chaps.',true),
('Nile perch authoritative yield','shared_pool',(select id from public.inventory_items where name='Nile perch'),'Nile perch portion',1,'kg',5,'portion','1 kg fillet produces 5 portions.',true),
('Tilapia authoritative yield','shared_pool',(select id from public.inventory_items where name='Tilapia'),'Tilapia portion',1,'whole fish',2,'portion','1 whole tilapia produces 2 portions.',true),
('Rice authoritative yield','yield',(select id from public.inventory_items where name='Rice'),'Rice portion',1,'kg',6,'portion','1 kg rice produces 6 portions.',true),
('Spirits 750ml shot','conversion',null,'Standard spirit shot',750,'ml',25,'shot','Baseline bottle is 750 ml. A shot is 30 ml per the authoritative specification; 30/750 = 0.04 bottle.',true),
('Focas 5L wine glass','conversion',null,'Focas wine glass',5000,'ml',20,'glass','5 litre box / 250 ml glass = 20 glasses; one glass = 0.05 box.',true),
('Espresso authoritative dose','portion',(select id from public.inventory_items where name='Coffee'),'Espresso',20,'g',1,'produce','Espresso uses 20 g coffee.',true),
('Large milkshake authoritative dose','portion',(select id from public.inventory_items where name='Ice cream'),'Large Milkshake',500,'g',1,'produce','Large milkshake uses 500 g ice cream plus 1/4 pint milk.',true),
('Small milkshake authoritative dose','portion',(select id from public.inventory_items where name='Ice cream'),'Small Milkshake',300,'g',1,'produce','Small milkshake uses 300 g ice cream plus 1/4 pint milk.',true),
('African coffee authoritative dose','portion',(select id from public.inventory_items where name='Coffee'),'African Coffee',20,'g',1,'produce','African coffee uses coffee plus 1 full pint milk. Existing Admin coffee configuration remains authoritative for the coffee quantity.',true),
('African tea authoritative dose','portion',(select id from public.inventory_items where name='Milk'),'African Tea',1,'pint',1,'pot','African tea uses tea plus 1 pint liquid. Existing tea configuration is preserved.',true)
) v(name,rule_type,inventory_item_id,output_name,input_quantity,input_unit,output_quantity,output_unit,notes,active)
where inventory_item_id is not null or name in ('Spirits 750ml shot','Focas 5L wine glass');

-- Ensure explicitly specified direct recipes exist. These are additive/upsert
-- style replacements only for the named menu items.
delete from public.menu_item_recipes mir
using public.menu_items m
where mir.menu_item_id=m.id
  and lower(trim(m.name)) in (
    'white rice','vegetable rice','egg fried rice',
    'beef samosa (pair)','kebab (each)','chaps each',
    'fish fillet (nile perch)','fish fingers (nile perch)',
    'fish sizzler (nile perch)',
    'fish fillet (tilapia)','fish fingers (tilapia)','fish sizzler (tilapia)',
    'espresso','african coffee','large milkshake','big milkshake','small milkshake'
  );

with desired(menu_name,inventory_name,quantity,recipe_unit) as (
values
('White Rice','Rice',1.0/6,'kg'),
('Vegetable rice','Rice',1.0/6,'kg'),
('Egg fried rice','Rice',1.0/6,'kg'),
('Beef Samosa (Pair)','Minced meat',2.0/40,'kg'),
('Kebab (each)','Minced meat',1.0/30,'kg'),
('Chaps each','Minced meat',1.0/30,'kg'),
('Fish Fillet (Nile Perch)','Nile perch',1.0/5,'kg'),
('Fish Fingers (Nile Perch)','Nile perch',1.0/5,'kg'),
('Fish sizzler (Nile Perch)','Nile perch',1.0/5,'kg'),
('Fish Fillet (Tilapia)','Tilapia',1.0/2,'whole fish'),
('Fish Fingers (Tilapia)','Tilapia',1.0/2,'whole fish'),
('Fish Sizzler (Tilapia)','Tilapia',1.0/2,'whole fish'),
('Espresso','Coffee',20,'g'),
('African Coffee','Coffee',20,'g'),
('African Coffee','Milk',1,'pint'),
('Large Milkshake','Ice cream',500,'g'),
('Large Milkshake','Milk',0.25,'pint'),
('Big Milkshake','Ice cream',500,'g'),
('Big Milkshake','Milk',0.25,'pint'),
('Small Milkshake','Ice cream',300,'g'),
('Small Milkshake','Milk',0.25,'pint')
)
insert into public.menu_item_recipes(menu_item_id,inventory_item_id,quantity,recipe_unit,stock_units_per_recipe_unit)
select m.id,i.id,d.quantity,d.recipe_unit,1
from desired d
join public.menu_items m on lower(trim(m.name))=lower(trim(d.menu_name))
join public.inventory_items i on lower(trim(i.name))=lower(trim(d.inventory_name));

-- Juice remains a purchase-batch conversion: no individual fruit counting.
-- Preserve all existing Admin fruit rules. Reassert only the two explicitly
-- confirmed values if those rows exist.
update public.inventory_recipe_rules
set input_quantity=5000,input_unit='UGX purchase batch',
    output_quantity=10,output_unit='glass',
    notes='UGX 5,000 orange purchase batch = 10 glasses. Individual fruit count is not used.',
    active=true
where name='Orange juice batch yield';

update public.inventory_recipe_rules
set input_quantity=5000,input_unit='UGX purchase batch',
    output_quantity=10,output_unit='glass',
    notes='UGX 5,000 lemon purchase batch = 10 glasses. Individual fruit count is not used.',
    active=true
where name='Lemon juice batch yield';

-- Cocktail is handled by finalize_order_inventory:
-- 1 selected fruit = 1/4 glass; 2 = 1/2 each; 3 = 1/3 each.
-- Do not create a direct raw-fruit recipe for Cocktail Glass.

commit;
