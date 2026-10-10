-- Kiteezi: connect private POS catalogue items to the shared order/payment/stock flow.
-- POS item IDs are authoritative; linked menu items retain their existing recipe/station rules.
begin;

create or replace function public.create_pos_order_v2(
  p_customer_name text,
  p_phone text,
  p_items jsonb,
  p_notes text default null,
  p_fulfillment_method text default 'dine_in'
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare
  v_customer uuid;
  v_order uuid;
  v_line jsonb;
  v_pos_item public.pos_items%rowtype;
  v_menu_item public.menu_items%rowtype;
  v_qty numeric;
  v_total numeric := 0;
  v_price numeric;
begin
  if not (private.has_permission('orders.manage') or private.has_permission('orders.create')) then
    raise exception 'You do not have permission to create POS orders';
  end if;
  if lower(coalesce(p_fulfillment_method,'')) not in ('dine_in','pickup','delivery') then
    raise exception 'Choose dine-in, pickup or delivery';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then
    raise exception 'Add at least one item before saving the order';
  end if;

  if coalesce(trim(p_customer_name),'') <> '' or coalesce(trim(p_phone),'') <> '' then
    insert into public.customers(name,phone)
    values(nullif(trim(coalesce(p_customer_name,'')),''), nullif(trim(coalesce(p_phone,'')),''))
    returning id into v_customer;
  end if;

  insert into public.orders(customer_id,source,status,payment_status,total,created_by,customer_notes,fulfillment_method)
  values(v_customer,'pos','open','unpaid',0,auth.uid(),nullif(trim(coalesce(p_notes,'')),''),lower(p_fulfillment_method))
  returning id into v_order;

  for v_line in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_line->>'id','') = '' then
      raise exception 'One of the POS items is missing its item ID';
    end if;
    begin
      v_pos_item.id := (v_line->>'id')::uuid;
    exception when invalid_text_representation then
      raise exception 'One of the selected POS items has an invalid ID';
    end;
    v_qty := (v_line->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 or v_qty > 10000 then
      raise exception 'Enter a valid quantity for each item';
    end if;

    select * into v_pos_item
    from public.pos_items
    where id = (v_line->>'id')::uuid
      and active = true and is_available = true and price_on_request = false
    for share;
    if not found then
      raise exception 'An item in this order is no longer available. Refresh the POS catalogue and try again';
    end if;
    if not exists(select 1 from public.pos_categories c where c.id=v_pos_item.category_id and c.active=true) then
      raise exception 'An item belongs to an inactive POS category. Refresh the catalogue and contact a manager';
    end if;

    v_price := v_pos_item.unit_price;
    if v_price < 0 then raise exception 'A POS item has an invalid price'; end if;

    if v_pos_item.menu_item_id is not null then
      select * into v_menu_item from public.menu_items
      where id=v_pos_item.menu_item_id and in_stock=true and price_on_request=false
      for share;
      if not found then
        raise exception 'A linked food or drink item is unavailable. Refresh the POS catalogue and try again';
      end if;
    end if;

    insert into public.order_items(order_id,menu_item_id,pos_item_id,qty,unit_price,notes,item_name_snapshot)
    values(v_order,v_pos_item.menu_item_id,v_pos_item.id,v_qty,v_price,null,v_pos_item.name);
    v_total := v_total + v_qty * v_price;
  end loop;

  if v_total <= 0 then raise exception 'Order total must be greater than zero'; end if;
  update public.orders set total=round(v_total,2) where id=v_order;
  return v_order;
end;
$function$;

revoke all on function public.create_pos_order_v2(text,text,jsonb,text,text) from public,anon;
grant execute on function public.create_pos_order_v2(text,text,jsonb,text,text) to authenticated,service_role;

-- Allocate completed-order revenue across the departments that actually sold the items.
-- One debit for the full order; credits split by POS department without duplicating revenue.
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
  v_line_total numeric;
  v_remainder numeric;
  v_fallback_department text;
begin
  if lower(coalesce(new.status,'')) not in ('completed','complete','fulfilled') or v_total <= 0 then
    return new;
  end if;
  if exists(select 1 from public.journal_entries where source_type='order' and source_id=new.id and status='posted') then
    return new;
  end if;

  v_fallback_department := case
    when lower(coalesce(new.source,'')) like '%swim%' then 'Swimming'
    when lower(coalesce(new.source,'')) like '%event%' then 'Events'
    when lower(coalesce(new.source,'')) like '%sport%' then 'Sports'
    else 'Bar/Kitchen'
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
  values(current_date,'order',new.id,'Completed POS order '||new.id,v_fallback_department,'posted',auth.uid())
  returning id into v_entry;

  insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description,department)
  values(v_entry,v_debit,v_total,0,'Order settlement',v_fallback_department);

  v_line_total := 0;
  for v_department, v_remainder in
    select
      coalesce(nullif(trim(pi.department_key),''), case
        when lower(coalesce(pc.name,'')) like '%swim%' then 'Swimming'
        when lower(coalesce(pc.name,'')) like '%sport%' then 'Sports'
        when lower(coalesce(pc.name,'')) like '%photo%' then 'Photography'
        when lower(coalesce(pc.name,'')) like '%event%' or lower(coalesce(pc.name,'')) like '%buffet%' then 'Events'
        when lower(coalesce(pc.name,'')) like '%bar%' or lower(coalesce(pc.name,'')) like '%drink%' then 'Bar'
        when oi.pos_item_id is null and lower(coalesce(mc.name,'')) like '%drink%' then 'Bar'
        else 'Kitchen'
      end) as department,
      sum(oi.qty * oi.unit_price) as amount
    from public.order_items oi
    left join public.pos_items pi on pi.id=oi.pos_item_id
    left join public.pos_categories pc on pc.id=pi.category_id
    left join public.menu_items mi on mi.id=oi.menu_item_id
    left join public.menu_categories mc on mc.id=mi.category_id
    where oi.order_id=new.id
    group by 1
    order by 1
  loop
    if v_remainder > 0 then
      insert into public.journal_entry_lines(journal_entry_id,account_id,debit,credit,description,department)
      values(v_entry,v_revenue,0,v_remainder,'Sales revenue',v_department);
      v_line_total := v_line_total + v_remainder;
    end if;
  end loop;

  -- Legacy orders without item rows, or totals not matching line snapshots, get a
  -- balancing credit so the journal always balances to the authoritative order total.
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
