-- POS payment method + accounting mapping.
-- Keeps payment method on the shared orders record and maps manual POS payments
-- to the correct cash/mobile-money asset account.

alter table public.orders
  add column if not exists payment_method text,
  add column if not exists payment_reference text,
  add column if not exists paid_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='orders_payment_method_check'
      and conrelid='public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_payment_method_check
      check (payment_method is null or payment_method in ('cash','mtn_momo','airtel_money'));
  end if;
end $$;

create index if not exists idx_orders_payment_method on public.orders(payment_method);

create or replace function public.record_pos_payment(
  p_order_id uuid,
  p_payment_method text,
  p_reference text default null
)
returns boolean
language plpgsql
security definer
set search_path to public, private, pg_catalog, pg_temp
as $function$
declare
  v_status text;
  v_total numeric;
begin
  if not (private.has_permission('orders.manage') or private.has_permission('orders.pay')) then
    raise exception 'Not authorized';
  end if;
  if lower(coalesce(p_payment_method,'')) not in ('cash','mtn_momo','airtel_money') then
    raise exception 'Unsupported payment method';
  end if;
  select status,total into v_status,v_total from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_status in ('cancelled','completed') then raise exception 'This order is already closed'; end if;
  if coalesce(v_total,0)<=0 then raise exception 'Order total must be greater than zero'; end if;
  update public.orders
  set payment_status='paid',
      payment_method=lower(trim(p_payment_method)),
      payment_reference=nullif(trim(coalesce(p_reference,'')),''),
      paid_at=now()
  where id=p_order_id;
  return true;
end;
$function$;

revoke all on function public.record_pos_payment(uuid,text,text) from public,anon;
grant execute on function public.record_pos_payment(uuid,text,text) to authenticated,service_role;

create or replace function public.post_completed_order_to_ledger()
returns trigger
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_total numeric:=coalesce(new.total,0);
  v_debit uuid;
  v_revenue uuid;
  v_department text;
  v_paid boolean:=lower(coalesce(new.payment_status,'')) in ('paid','complete','completed');
  v_entry uuid;
  v_method text:=lower(coalesce(new.payment_method,'cash'));
begin
  if lower(coalesce(new.status,'')) not in ('completed','complete','fulfilled') or v_total<=0 then return new; end if;
  if exists(select 1 from public.journal_entries where source_type='order' and source_id=new.id and status='posted') then return new; end if;
  v_department:=case
    when lower(coalesce(new.source,'')) like '%swim%' then 'Swimming'
    when lower(coalesce(new.source,'')) like '%event%' then 'Events'
    when lower(coalesce(new.source,'')) like '%sport%' then 'Sports'
    else 'Bar/Kitchen'
  end;
  select id into v_revenue from public.chart_of_accounts where code='4000' limit 1;
  if v_paid then
    select id into v_debit from public.chart_of_accounts
    where code=case v_method when 'mtn_momo' then '1020' when 'airtel_money' then '1030' else '1000' end
    limit 1;
  else
    select id into v_debit from public.chart_of_accounts where code='1100' limit 1;
  end if;
  if v_debit is null or v_revenue is null then raise exception 'Required accounting accounts are missing'; end if;
  insert into public.journal_entries(entry_date,source_type,source_id,description,department,status,created_by)
  values(current_date,'order',new.id,'Completed order '||new.id,v_department,'posted',auth.uid())
  returning id into v_entry;
  insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description,department)
  values
    (v_entry,v_debit,v_total,0,'Order settlement',v_department),
    (v_entry,v_revenue,0,v_total,'Sales revenue',v_department);
  return new;
end
$function$;

create or replace function public.post_order_payment_to_ledger()
returns trigger
language plpgsql
security definer
set search_path to public, pg_temp
as $function$
declare
  v_total numeric:=coalesce(new.total,0);
  v_cash uuid;
  v_ar uuid;
  v_entry uuid;
  v_method text:=lower(coalesce(new.payment_method,'cash'));
begin
  if lower(coalesce(new.status,'')) not in ('completed','complete','fulfilled')
     or lower(coalesce(new.payment_status,'')) not in ('paid','complete','completed')
     or v_total<=0 then return new; end if;
  if not exists(select 1 from public.journal_entries where source_type='order' and source_id=new.id and status='posted') then return new; end if;
  if not exists(select 1 from public.journal_entries where source_type='order_payment' and source_id=new.id and status='posted') then
    select id into v_cash from public.chart_of_accounts
    where code=case v_method when 'mtn_momo' then '1020' when 'airtel_money' then '1030' else '1000' end
    limit 1;
    select id into v_ar from public.chart_of_accounts where code='1100' limit 1;
    if v_cash is null or v_ar is null then raise exception 'Payment account or receivable account missing'; end if;
    insert into public.journal_entries(entry_date,source_type,source_id,description,department,status,created_by)
    values(current_date,'order_payment',new.id,'Payment received for order '||new.id,
           case when lower(coalesce(new.source,'')) like '%swim%' then 'Swimming' when lower(coalesce(new.source,'')) like '%event%' then 'Events' when lower(coalesce(new.source,'')) like '%sport%' then 'Sports' else 'Bar/Kitchen' end,
           'posted',auth.uid()) returning id into v_entry;
    insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description,department)
    values(v_entry,v_cash,v_total,0,'Payment received',null),(v_entry,v_ar,0,v_total,'Receivable settled',null);
  end if;
  return new;
end
$function$;

insert into public.chart_of_accounts(code,name,account_type,active)
values ('1020','MTN Mobile Money','asset',true),('1030','Airtel Money','asset',true)
on conflict (code) do update set name=excluded.name,account_type=excluded.account_type,active=true;

revoke all on function public.post_completed_order_to_ledger() from public,anon,authenticated;
revoke all on function public.post_order_payment_to_ledger() from public,anon,authenticated;
grant execute on function public.post_completed_order_to_ledger() to postgres,service_role;
grant execute on function public.post_order_payment_to_ledger() to postgres,service_role;
