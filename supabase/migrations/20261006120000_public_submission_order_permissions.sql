-- Public submission and order hardening
-- Keeps anonymous customer flows limited to their intended entry points.

grant insert on table public.reviews to anon;
revoke update, delete on table public.reviews from anon;

revoke insert, update, delete on table public.gallery_items from anon;
grant select on table public.gallery_items to anon;

revoke execute on function public.place_website_order(text,text,text,text,text,text,jsonb) from anon, authenticated, public;
grant execute on function public.place_website_order_idempotent(uuid,text,text,text,text,text,text,jsonb) to anon;
