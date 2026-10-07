revoke execute on function public.admin_delete_business_record(text,uuid) from anon;
revoke execute on function public.admin_delete_business_record(text,uuid) from public;
grant execute on function public.admin_delete_business_record(text,uuid) to authenticated;
