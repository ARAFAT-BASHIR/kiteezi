-- Populate missing menu images using category/item-appropriate fallback photography.
-- Existing non-null image URLs are preserved.
update public.menu_items m
set img_url=case
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%burger%' then 'https://images.unsplash.com/photo-1767065703793-7012f5fced19?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%pizza%' then 'https://images.unsplash.com/photo-1751368647711-2e2ee6d0b7c6?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%chicken%' then 'https://images.unsplash.com/photo-1725728286008-6bdec0508a71?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%fish%' then 'https://images.unsplash.com/photo-1519233991914-26a44330ccd7?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%salad%' or lower(coalesce(c.name,'')) like '%desert%' then 'https://images.unsplash.com/photo-1568106690134-f2ee2257a9ef?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%juice%' then 'https://images.unsplash.com/photo-1617535394182-641e70651cd8?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%coffee%' then 'https://images.unsplash.com/photo-1681477508108-6d3164936ac4?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%milkshake%' or lower(coalesce(c.name,'')) like '%shake%' then 'https://images.unsplash.com/photo-1553787499-6f9133860278?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%beer%' or lower(coalesce(c.name,'')) like '%beer%' then 'https://images.unsplash.com/photo-1597822738124-151fb72dcb79?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%wine%' or lower(coalesce(c.name,'')) like '%wine%' then 'https://images.unsplash.com/photo-1610458034932-dc165f29499e?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%whisk%' or lower(coalesce(c.name,'')) like '%spirit%' or lower(coalesce(c.name,'')) like '%gin%' or lower(coalesce(c.name,'')) like '%vodka%' or lower(coalesce(c.name,'')) like '%cream%' or lower(coalesce(c.name,'')) like '%champagne%' then 'https://images.unsplash.com/photo-1671713682265-991d47c88b85?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%breakfast%' then 'https://images.unsplash.com/photo-1734770205674-d117e4ba7926?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%hot pot%' or lower(coalesce(c.name,'')) like '%hot pot%' then 'https://www.asiancookingmom.com/wp-content/uploads/2023/01/Hot-Pot-15-of-17-1.jpg'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%samosa%' then 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=900&q=80'
  when lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%goat%' or lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%liver%' or lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%beef%' or lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%meat%' or lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%sausage%' or lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%kebab%' or lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%chips%' or lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%rolex%' or lower(coalesce(m.name,'')||' '||coalesce(c.name,'')) like '%buffet%' then 'https://images.unsplash.com/photo-1725728286008-6bdec0508a71?auto=format&fit=crop&w=900&q=80'
  else 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=900&q=80'
end,
alt_text=coalesce(nullif(trim(m.alt_text),''),m.name)
from public.menu_categories c
where c.id=m.category_id and m.img_url is null;
