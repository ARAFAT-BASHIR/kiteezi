-- Kiteezi: payment is independent of fulfilment, including auto-completed record-only services.
begin;

create or replace function public.record_pos_payment(
  p_order_id uuid,
  p_payment_method text,
  p_reference text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare
  v_status text;
  v_total numeric;
begin
  if not (private.has_permission('orders.manage') or private.has_permission('orders.pay')) then
    raise exception 'You do not have permission to record this payment';
  end if;
  if lower(coalesce(p_payment_method,'')) not in ('cash','mtn_momo','airtel_money') then
    raise exception 'Choose cash, MTN Mobile Money or Airtel Money';
  end if;
  select status,total into v_status,v_total from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_status='cancelled' then raise exception 'A cancelled order cannot be marked as paid'; end if;
  if lower(coalesce((select payment_status from public.orders where id=p_order_id),'')) in ('paid','complete','completed') then
    raise exception 'This order is already marked as paid';
  end if;
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

-- Keep department reporting readable while preserving the configured POS department key.
create or replace function public.post_completed_order_to_ledger()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare
  v_total numeric := coalesce(new.total,0);
  v_debit uuid;
  v_revenue uuid;
  v_department text;
  v_entry uuid;
  v_method text := lower(coalesce(new.payment_method,'cash'));
  v_paid boolean := lower(coalesce(new.payment_status,'')) in ('paid','complete','completed');
  v_line_total numeric := 0;
  v_amount numeric;
  v_fallback_department text;
begin
  if lower(coalesce(new.status,'')) not in ('completed','complete','fulfilled') or v_total<=0 then return new; end if;
  if exists(select 1 from public.journal_entries where source_type='order' and source_id=new.id and status='posted') then return new; end if;

  v_fallback_department := case
    when lower(coalesce(new.source,'')) like '%swim%' then 'Swimming'
    when lower(coalesce(new.source,'')) like '%event%' then 'Events'
    when lower(coalesce(new.source,'')) like '%sport%' then 'Sports'
    else 'Kitchen'
  end;
  select id into v_revenue from public.chart_of_accounts where code='4000' limit 1;
  if v_paid then
    select id into v_debit from public.chart_of_accounts
    where code=case v_method when 'mtn_momo' then '1020' when 'airtel_money' then '1030' else '1000' end limit 1;
  else
    select id into v_debit from public.chart_of_accounts where code='1100' limit 1;
  end if;
  if v_debit is null or v_revenue is null then raise exception 'Required accounting accounts are missing'; end if;

  insert into public.journal_entries(entry_date,source_type,source_id,description,department,status,created_by)
  values(current_date,'order',new.id,'Completed order '||new.id,v_fallback_department,'posted',auth.uid())
  returning id into v_entry;
  insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description,department)
  values(v_entry,v_debit,v_total,0,'Order settlement',v_fallback_department);

  for v_department,v_amount in
    select
      case lower(coalesce(nullif(trim(pi.department_key),''),'' ))
        when 'barista' then 'Bar'
        when 'bar' then 'Bar'
        when 'kitchen' then 'Kitchen'
        when 'swimming' then 'Swimming'
        when 'sports' then 'Sports'
        when 'buffet' then 'Events'
        when 'events' then 'Events'
        when 'photography' then 'Photography'
        else coalesce(nullif(trim(pi.department_key),''),case
          when lower(coalesce(pc.name,'')) like '%swim%' then 'Swimming'
          when lower(coalesce(pc.name,'')) like '%sport%' then 'Sports'
          when lower(coalesce(pc.name,'')) like '%photo%' then 'Photography'
          when lower(coalesce(pc.name,'')) like '%event%' or lower(coalesce(pc.name,'')) like '%buffet%' then 'Events'
          when lower(coalesce(pc.name,'')) like '%bar%' or lower(coalesce(pc.name,'')) like '%drink%' then 'Bar'
          when oi.pos_item_id is null and lower(coalesce(mc.name,'')) like '%drink%' then 'Bar'
          else 'Kitchen'
        end)
      end as department,
      sum(oi.qty*oi.unit_price) as amount
    from public.order_items oi
    left join public.pos_items pi on pi.id=oi.pos_item_id
    left join public.pos_categories pc on pc.id=pi.category_id
    left join public.menu_items mi on mi.id=oi.menu_item_id
    left join public.menu_categories mc on mc.id=mi.category_id
    where oi.order_id=new.id
    group by 1
    order by 1
  loop
    if v_amount>0 then
      insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description,department)
      values(v_entry,v_revenue,0,v_amount,'Sales revenue',v_department);
      v_line_total:=v_line_total+v_amount;
    end if;
  end loop;

  if v_line_total < v_total then
    insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description,department)
    values(v_entry,v_revenue,0,round(v_total-v_line_total,2),'Sales revenue adjustment',v_fallback_department);
  elsif v_line_total > v_total then
    raise exception 'Order line totals exceed order total; accounting entry was not completed';
  end if;
  return new;
end
$function$;

revoke all on function public.post_completed_order_to_ledger() from public,anon,authenticated;
grant execute on function public.post_completed_order_to_ledger() to postgres,service_role;

commit;
