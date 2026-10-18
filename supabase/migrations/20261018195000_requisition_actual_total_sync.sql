-- Keep requisition actual totals authoritative in the database.
-- The UI also displays a live preview, but persisted totals must never depend on browser JavaScript.

create or replace function private.recompute_requisition_actual_total()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.actual_total := case
    when new.actual_unit_price is null then null
    else round(coalesce(new.quantity, 0) * new.actual_unit_price, 2)
  end;
  return new;
end;
$$;

revoke all on function private.recompute_requisition_actual_total() from public, anon, authenticated;

drop trigger if exists requisition_items_actual_total_sync on public.requisition_items;
create trigger requisition_items_actual_total_sync
before insert or update of quantity, actual_unit_price
on public.requisition_items
for each row
execute function private.recompute_requisition_actual_total();

drop trigger if exists requisition_version_items_actual_total_sync on public.requisition_version_items;
create trigger requisition_version_items_actual_total_sync
before insert or update of quantity, actual_unit_price
on public.requisition_version_items
for each row
execute function private.recompute_requisition_actual_total();

update public.requisition_items
set actual_total = case
  when actual_unit_price is null then null
  else round(coalesce(quantity, 0) * actual_unit_price, 2)
end
where actual_total is distinct from case
  when actual_unit_price is null then null
  else round(coalesce(quantity, 0) * actual_unit_price, 2)
end;

update public.requisition_version_items
set actual_total = case
  when actual_unit_price is null then null
  else round(coalesce(quantity, 0) * actual_unit_price, 2)
end
where actual_total is distinct from case
  when actual_unit_price is null then null
  else round(coalesce(quantity, 0) * actual_unit_price, 2)
end;
