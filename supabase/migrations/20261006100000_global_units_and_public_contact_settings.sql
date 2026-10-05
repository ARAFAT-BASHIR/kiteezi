create table if not exists public.unit_options (
  code text primary key,
  label text not null,
  category text not null default 'general',
  sort_order integer not null default 100,
  active boolean not null default true
);
alter table public.unit_options enable row level security;
revoke all on table public.unit_options from anon, authenticated;
grant select on table public.unit_options to authenticated;
drop policy if exists unit_options_select_authenticated on public.unit_options;
create policy unit_options_select_authenticated on public.unit_options for select to authenticated using (active=true);
insert into public.unit_options(code,label,category,sort_order) values
('piece','Piece','count',10),('portion','Portion','count',20),('bottle','Bottle','beverage',30),('glass','Glass','beverage',40),('shot','Shot','beverage',50),('pour','Pour','beverage',60),('can','Can','beverage',70),('crate','Crate','count',80),('pack','Pack','count',90),('bag','Bag','count',100),('box','Box','count',110),('kg','Kilogram (kg)','mass',120),('g','Gram (g)','mass',130),('mg','Milligram (mg)','mass',140),('litre','Litre (L)','volume',150),('ml','Millilitre (ml)','volume',160),('pint','Pint','volume',170),('cup','Cup','volume',180),('tablespoon','Tablespoon','volume',190),('teaspoon','Teaspoon','volume',200),('produce','Produce','count',210),('batch','Batch','production',220),('pot','Pot','count',230),('tray','Tray','count',240)
on conflict(code) do update set label=excluded.label,category=excluded.category,sort_order=excluded.sort_order,active=true;
insert into public.unit_options(code,label,category,sort_order)
select distinct lower(trim(unit)),trim(unit),'existing',500 from public.inventory_items where nullif(trim(unit),'') is not null
on conflict(code) do nothing;
insert into public.unit_options(code,label,category,sort_order)
select distinct lower(trim(serving_unit)),trim(serving_unit),'existing',510 from public.menu_items where nullif(trim(serving_unit),'') is not null
on conflict(code) do nothing;
insert into public.unit_options(code,label,category,sort_order)
select distinct lower(trim(recipe_unit)),trim(recipe_unit),'existing',520 from public.menu_item_recipes where nullif(trim(recipe_unit),'') is not null
on conflict(code) do nothing;
insert into public.unit_options(code,label,category,sort_order)
select distinct lower(trim(unit_code)),trim(unit_code),'existing',530 from public.requisition_items where nullif(trim(unit_code),'') is not null
on conflict(code) do nothing;
insert into public.site_settings(key,value) values
('location_url','https://www.google.com/maps/search/?api=1&query=Kiteezi+Lusanja+Kampala+Uganda'),
('information_email',''),('bookings_email','')
on conflict(key) do nothing;
drop policy if exists "Public can read public site settings" on public.site_settings;
create policy "Public can read public site settings" on public.site_settings for select to anon,authenticated using (key=any(array['business_name','business_tagline','location','location_url','phone','phone_link','whatsapp','whatsapp_link','whatsapp_number','facebook','instagram','youtube','tiktok','x','logo_url','airtel_money','mtn_money','information_email','bookings_email']));
grant select on public.site_settings to anon,authenticated;