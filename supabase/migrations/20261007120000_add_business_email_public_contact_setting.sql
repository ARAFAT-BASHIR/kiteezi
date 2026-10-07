insert into public.site_settings(key,value)
values ('business_email','')
on conflict(key) do nothing;

drop policy if exists "Public can read public site settings" on public.site_settings;
create policy "Public can read public site settings"
on public.site_settings
for select to anon,authenticated
using (key=any(array[
  'business_name','business_tagline','location','location_url','phone','phone_link',
  'whatsapp','whatsapp_link','whatsapp_number','facebook','instagram','youtube',
  'tiktok','x','logo_url','airtel_money','mtn_money','information_email',
  'bookings_email','business_email'
]));

grant select on public.site_settings to anon,authenticated;