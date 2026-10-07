-- Keep order-related accounting in sync with the order lifecycle.
create or replace function public.cleanup_order_ledger_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  delete from public.journal_entry_lines
  where journal_entry_id in (
    select id
    from public.journal_entries
    where source_id = old.id
      and source_type in ('order','order_payment')
  );

  delete from public.journal_entries
  where source_id = old.id
    and source_type in ('order','order_payment');

  return old;
end
$function$;

drop trigger if exists trg_cleanup_order_ledger_on_delete on public.orders;
create trigger trg_cleanup_order_ledger_on_delete
after delete on public.orders
for each row
execute function public.cleanup_order_ledger_on_delete();

-- Remove ledger entries left behind by orders deleted before this fix.
delete from public.journal_entry_lines
where journal_entry_id in (
  select je.id
  from public.journal_entries je
  left join public.orders o on o.id = je.source_id
  where je.source_type in ('order','order_payment')
    and o.id is null
);

delete from public.journal_entries je
where je.source_type in ('order','order_payment')
  and not exists (
    select 1 from public.orders o where o.id = je.source_id
  );
