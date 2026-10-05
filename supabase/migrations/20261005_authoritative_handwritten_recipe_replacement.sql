-- Kiteezi / KH Desert Recreation Center
-- Authoritative handwritten inventory-yield replacement
-- Applied to Supabase project recreational on 2026-10-05.
--
-- Important: shared pools (potato, fish, minced meat, chicken, cocktail)
-- are stored as yield rules. They must not be represented as independent
-- raw-stock deductions because the same source stock can be allocated to
-- alternative products.

begin;

delete from public.menu_item_recipes;
delete from public.menu_recipes;
delete from public.menu_item_inventory_map;
delete from public.inventory_recipe_rules;

update public.inventory_items
set unit = 'purchase batch'
where name in ('Orange','Lemon','Pineapple','Passion fruit','Beetroot','Watermelon','Mango');

insert into public.inventory_recipe_rules
(name,rule_type,inventory_item_id,output_name,input_quantity,input_unit,output_quantity,output_unit,notes,active)
select * from (
values
('Potato shared pool','shared_pool',(select id from public.inventory_items where name='Potato'),'Big-equivalent potato plate',1,'basin',84,'big-equivalent plate','One basin = 84 big-equivalent plates. The same pool may be used as chips, mashed potatoes, potato wedges or boiled potatoes.',true),
('Potato small-chip pool','conversion',(select id from public.inventory_items where name='Potato'),'Small chips plate',1,'basin',123,'small chips plates','One basin can alternatively produce 123 plates of UGX 8,000 chips.',true),
('Liver yield','yield',(select id from public.inventory_items where name='Liver'),'Liver portion',1,'kg',4,'portion','1 kg liver = 4 portions.',true),
('Goat yield','yield',(select id from public.inventory_items where name='Goat'),'Goat portion',1,'kg',2,'portion','1 kg goat = 2 portions.',true),
('Nile perch shared pool','shared_pool',(select id from public.inventory_items where name='Nile perch'),'Nile perch portion',1,'kg',5,'portion','1 kg Nile perch fillet = 5 fillet portions OR 5 fish-finger portions.',true),
('Tilapia shared pool','shared_pool',(select id from public.inventory_items where name='Tilapia'),'Tilapia portion',1,'whole fish',2,'portion','One whole tilapia = 2 fillet portions OR 2 fish-finger portions, or may be sold whole.',true),
('Rice yield','yield',(select id from public.inventory_items where name='Rice'),'Rice portion',1,'kg',6,'portion','1 kg rice = 6 portions.',true),
('Posho yield','yield',(select id from public.inventory_items where name='Maize flour / Posho'),'Posho portion',1,'kg',6,'portion','1 kg posho = 6 portions.',true),
('Egg dish dose','portion',(select id from public.inventory_items where name='Egg'),'Egg dish',2,'eggs',1,'dish','Each egg dish uses 2 eggs.',true),
('Minced meat shared pool','shared_pool',(select id from public.inventory_items where name='Minced meat'),'Minced-meat products',1,'kg',1,'shared pool','1 kg minced meat = 40 beef samosas OR 4 beef-pizza topping portions OR 30 kebabs OR 30 chaps.',true),
('Popcorn yield','yield',(select id from public.inventory_items where name='Popcorn'),'Popcorn portion',1,'kg',4,'portion','1 kg popcorn = 4 portions.',true),
('Shot volume','conversion',null,'Shot',30,'ml',1,'shot','1 shot = 30 ml.',true),
('Wine glass volume','conversion',null,'Wine glass',150,'ml',1,'glass','1 wine glass = 150 ml.',true),
('Orange juice batch yield','yield',(select id from public.inventory_items where name='Orange'),'Orange Juice Glass',5000,'UGX purchase batch',10,'glass','UGX 5,000 orange purchase batch = 10 glasses. Individual fruit count is not used.',true),
('Lemon juice batch yield','yield',(select id from public.inventory_items where name='Lemon'),'Lemon Juice Glass',5000,'UGX purchase batch',10,'glass','UGX 5,000 lemon purchase batch = 10 glasses. Individual fruit count is not used.',true),
('Pineapple juice batch yield','yield',(select id from public.inventory_items where name='Pineapple'),'Pineapple Juice Glass',5000,'UGX purchase batch',6,'glass','UGX 5,000 pineapple purchase batch = 6 glasses. Individual fruit count is not used.',true),
('Passion fruit juice batch yield','yield',(select id from public.inventory_items where name='Passion fruit'),'Passion Fruit Juice Glass',5000,'UGX purchase batch',10,'glass','UGX 5,000 passion-fruit purchase batch = 10 glasses. Individual fruit count is not used.',true),
('Beetroot juice batch yield','yield',(select id from public.inventory_items where name='Beetroot'),'Beetroot Juice Glass',5000,'UGX purchase batch',6,'glass','UGX 5,000 beetroot purchase batch = 6 glasses. Individual beetroot count is not used.',true),
('Watermelon juice batch yield','yield',(select id from public.inventory_items where name='Watermelon'),'Watermelon Juice Glass',10000,'UGX purchase batch',6,'glass','UGX 10,000 watermelon purchase batch = 6 glasses. Individual watermelon count is not used.',true),
('Mango juice batch yield','yield',(select id from public.inventory_items where name='Mango'),'Mango Juice Glass',5000,'UGX purchase batch',2,'glass','UGX 5,000 mango purchase batch = 2 glasses. Individual mango count is not used.',true),
('Cocktail equal-share allocation','shared_pool',null,'Cocktail Glass',1,'glass',1,'glass','A cocktail uses a fraction of a full fruit-juice glass from each selected fruit: 2 fruits = 1/2 each, 3 = 1/3 each, etc.',true),
('African tea milk','portion',(select id from public.inventory_items where name='Milk'),'African Tea (Single Pot)',1,'pint',1,'pot','1 pot uses 1 pint milk.',true),
('African coffee milk','portion',(select id from public.inventory_items where name='Milk'),'African Coffee',1,'pint',1,'produce','1 African coffee produce uses 1 pint milk.',true),
('Coffee dose','portion',(select id from public.inventory_items where name='Coffee'),'Coffee produce',20,'g',1,'produce','Coffee consumes 20 g per produce.',true),
('Chicken wings cut profile','shared_pool',(select id from public.inventory_items where name='Whole chicken'),'Chicken wings cut',1,'whole chicken',1,'cut batch','One chicken cut for wings yields the handwritten combination: 4 wing pieces, 1.5 chicken-pizza topping portions and 2 plain chicken pieces. The sheet also says the wing dish contains 6 pieces, so this remains a production rule rather than a blind direct deduction.',true),
('Chicken drumsticks cut profile','shared_pool',(select id from public.inventory_items where name='Whole chicken'),'Chicken drumsticks cut',1,'whole chicken',1,'cut batch','One chicken cut for drumsticks yields 2 drumstick pieces, 1 chicken-pizza topping portion and 2 plain chicken pieces.',true),
('Chicken mixed cut profile','shared_pool',(select id from public.inventory_items where name='Whole chicken'),'Chicken mixed cut',1,'whole chicken',1,'cut batch','One chicken can yield 4 wing pieces, 2 chicken-pizza topping portions and 2 drumstick-dish pieces.',true),
('Chicken plain cut profile','shared_pool',(select id from public.inventory_items where name='Whole chicken'),'Plain chicken pieces',1,'whole chicken',16,'plain chicken pieces','One chicken can be used strictly for 16 plain chicken pieces.',true)
) v(name,rule_type,inventory_item_id,output_name,input_quantity,input_unit,output_quantity,output_unit,notes,active);

with desired(menu_name,inventory_name,quantity,recipe_unit) as (
values
('Chips big','Potato',1.0/84,'big-equivalent plate'),
('Chips plain ordinary (Big)','Potato',1.0/84,'big-equivalent plate'),
('Chips & Sausages Big','Potato',1.0/84,'big-equivalent plate'),
('Chips small','Potato',1.0/123,'small chips plate'),
('Chips plain ordinary (Small)','Potato',1.0/123,'small chips plate'),
('Chips & Sausages small','Potato',1.0/123,'small chips plate'),
('Potato wedges','Potato',1.0/84,'big-equivalent plate'),
('Mashed potatoes','Potato',1.0/84,'big-equivalent plate'),
('Boiled potatoes','Potato',1.0/84,'big-equivalent plate'),
('Roasted potatoes','Potato',1.0/84,'big-equivalent plate'),
('Pan Fried Liver (1/4)','Liver',0.25,'kg'),
('Pan Fried Liver (1KG)','Liver',1,'kg'),
('Goat (1 kg)','Goat',1,'kg'),
('Goat (1/2 kg)','Goat',0.5,'kg'),
('Whole Fish','Tilapia',1,'whole fish'),
('Oven Baked Fish (whole)','Tilapia',1,'whole fish'),
('Fish Fillet (Nile Perch)','Nile perch',0.2,'kg'),
('Fish Fingers (Nile Perch)','Nile perch',0.2,'kg'),
('Fish sizzler (Nile Perch)','Nile perch',0.2,'kg'),
('Fish Fillet (Tilapia)','Tilapia',0.5,'whole fish'),
('Fish Fingers (Tilapia)','Tilapia',0.5,'whole fish'),
('Fish Sizzler (Tilapia)','Tilapia',0.5,'whole fish'),
('White Rice','Rice',1.0/6,'kg'),
('Vegetable rice','Rice',1.0/6,'kg'),
('Egg fried rice','Rice',1.0/6,'kg'),
('Egg fried rice','Egg',2,'eggs'),
('Posho','Maize flour / Posho',1.0/6,'kg'),
('Beef Samosa (Pair)','Minced meat',0.05,'kg'),
('Beef Pizza Large','Minced meat',0.25,'kg'),
('Kebab (each)','Minced meat',1.0/30,'kg'),
('Chaps each','Minced meat',1.0/30,'kg'),
('Popcorn single','Popcorn',0.25,'kg'),
('Orange Juice Glass','Orange',0.1,'purchase batch'),
('Lemon Juice Glass','Lemon',0.1,'purchase batch'),
('Pineapple Juice Glass','Pineapple',1.0/6,'purchase batch'),
('Passion Fruit Juice Glass','Passion fruit',0.1,'purchase batch'),
('Beetroot Juice Glass','Beetroot',1.0/6,'purchase batch'),
('Watermelon Juice Glass','Watermelon',1.0/6,'purchase batch'),
('Mango Juice Glass','Mango',0.5,'purchase batch'),
('African Tea (Single Pot)','Milk',1,'pint'),
('Black Coffee (Single Pot)','Coffee',20,'g'),
('Chicken stew','Whole chicken',1.0/16,'plain chicken piece'),
('African Curry Chicken','Whole chicken',1.0/16,'plain chicken piece'),
('Indian Curry Chicken','Whole chicken',1.0/16,'plain chicken piece'),
('Chicken Pilawo','Whole chicken',1.0/16,'plain chicken piece')
)
insert into public.menu_item_recipes(menu_item_id,inventory_item_id,quantity,recipe_unit,stock_units_per_recipe_unit)
select m.id,i.id,d.quantity,d.recipe_unit,1
from desired d
join public.menu_items m on m.name=d.menu_name
join public.inventory_items i on i.name=d.inventory_name;

commit;
