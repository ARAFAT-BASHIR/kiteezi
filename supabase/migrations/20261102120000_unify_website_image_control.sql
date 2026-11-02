alter table public.media add column if not exists slot_key text;
with numbered_media as (
 select id,row_number() over (partition by page_slug order by sort_order asc nulls last,created_at asc,id asc) as image_number
 from public.media where coalesce(is_gallery,false)=false and page_slug in ('index','about','events','sports','swimming')
)
update public.media m set slot_key='image-'||n.image_number::text from numbered_media n
where m.id=n.id and (m.slot_key is null or m.slot_key='');
update public.media set slot_key='hero' where page_slug='menu' and coalesce(is_gallery,false)=false and (slot_key is null or slot_key='');
insert into public.media (title,area,type,url,sort_order,active,caption,alt_text,page_slug,is_gallery,slot_key)
select v.title,v.area,'image',v.url,0,true,v.caption,v.alt_text,v.page_slug,false,'hero'
from (values
 ('Booking page hero','booking','https://images.unsplash.com/photo-1519315901367-f34ff9154487?auto=format&fit=crop&w=1800&q=85','Booking and restaurant service','Kiteezi booking page background','booking'),
 ('Contact page hero','contact','https://images.unsplash.com/photo-1519315901367-f34ff9154487?auto=format&fit=crop&w=1800&q=85','Kiteezi outdoor setting','Kiteezi contact page background','contact'),
 ('School swimming request hero','school-swimming-booking','https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80','School swimming','School swimming booking page background','school-swimming-booking'),
 ('Swimming schedule hero','swimming-schedule','https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80','Swimming schedule','Swimming schedule page background','swimming-schedule')
) as v(title,area,url,caption,alt_text,page_slug)
where not exists (select 1 from public.media existing where existing.page_slug=v.page_slug and existing.slot_key='hero' and coalesce(existing.is_gallery,false)=false);
