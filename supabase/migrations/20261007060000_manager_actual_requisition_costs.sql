-- Manager actual-cost capture for requisitions.
alter table public.requisition_items
  add column if not exists actual_unit_price numeric(14,2),
  add column if not exists actual_total numeric(18,2)
    generated always as (round(quantity * coalesce(actual_unit_price,0),2)) stored;
alter table public.requisition_version_items
  add column if not exists actual_unit_price numeric(14,2),
  add column if not exists actual_total numeric(18,2)
    generated always as (round(quantity * coalesce(actual_unit_price,0),2)) stored;
alter table public.approval_audit_trail add column if not exists actual_cost_snapshot jsonb;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='requisition_items_actual_unit_price_positive' and conrelid='public.requisition_items'::regclass) then
    alter table public.requisition_items add constraint requisition_items_actual_unit_price_positive check (actual_unit_price is null or actual_unit_price > 0);
  end if;
  if not exists(select 1 from pg_constraint where conname='requisition_version_items_actual_unit_price_positive' and conrelid='public.requisition_version_items'::regclass) then
    alter table public.requisition_version_items add constraint requisition_version_items_actual_unit_price_positive check (actual_unit_price is null or actual_unit_price > 0);
  end if;
end $$;

drop function if exists public.approve_requisition(uuid,text,jsonb,text);

create or replace function public.approve_requisition(
  p_requisition_id uuid,p_action text,p_items jsonb default null,p_reason text default null,p_actual_items jsonb default null
) returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
  v_uid uuid:=auth.uid(); v_org uuid:=public.current_organization_id(); v_req public.requisitions%rowtype;
  v_role text; v_stage text; v_prev_version uuid; v_new_version uuid; v_item jsonb;
  v_po uuid; v_po_number text; v_actual_snapshot jsonb; v_old_actual jsonb;
begin
  if v_uid is null or v_org is null then raise exception 'Authentication required.'; end if;
  select role into v_role from public.profiles where id=v_uid and active=true and organization_id=v_org;
  select * into v_req from public.requisitions where id=p_requisition_id and organization_id=v_org for update;
  if not found then raise exception 'Requisition not found.'; end if;
  v_stage:=case v_req.status when 'manager_pending' then 'manager' when 'gm_pending' then 'gm' when 'ceo_pending' then 'ceo' else null end;
  if v_stage is null then raise exception 'This requisition is not awaiting an approval.'; end if;
  if v_stage='manager' and v_role<>'manager' then raise exception 'Only the Manager can approve this stage.'; end if;
  if v_stage='gm' and v_role<>'general_manager' then raise exception 'Only the General Manager can approve this stage.'; end if;
  if v_stage='ceo' and v_role not in ('ceo','owner') then raise exception 'Only the CEO can approve this stage.'; end if;
  if p_action not in ('approved','edited','rejected') then raise exception 'Invalid approval action.'; end if;

  select id into v_prev_version from public.requisition_versions where requisition_id=v_req.id and version_number=v_req.current_version;

  if p_action='edited' then
    if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'A reason is mandatory whenever an approver edits a requisition.'; end if;
    if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Edited requisitions must contain at least one item.'; end if;

    select coalesce(jsonb_agg(jsonb_build_object('inventory_item_id',inventory_item_id,'actual_unit_price',actual_unit_price)), '[]'::jsonb)
      into v_old_actual
    from public.requisition_items where requisition_id=v_req.id;

    v_new_version:=gen_random_uuid();
    insert into public.requisition_versions(id,requisition_id,version_number,created_by,stage,change_reason)
    values(v_new_version,v_req.id,v_req.current_version+1,v_uid,v_stage,p_reason);

    delete from public.requisition_items where requisition_id=v_req.id;

    for v_item in select * from jsonb_array_elements(p_items) loop
      if coalesce((v_item->>'quantity')::numeric,0)<=0 then raise exception 'Edited quantities must be positive.'; end if;
      insert into public.requisition_items(requisition_id,inventory_item_id,quantity,unit_code,estimated_unit_price,actual_unit_price)
      values(
        v_req.id,(v_item->>'inventory_item_id')::uuid,(v_item->>'quantity')::numeric,
        coalesce(nullif(v_item->>'unit_code',''),(select unit from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid)),
        nullif(v_item->>'estimated_unit_price','')::numeric,
        (select nullif(a->>'actual_unit_price','')::numeric from jsonb_array_elements(v_old_actual) a
         where (a->>'inventory_item_id')::uuid=(v_item->>'inventory_item_id')::uuid limit 1)
      );
    end loop;

    insert into public.requisition_version_items(version_id,inventory_item_id,quantity,unit_code,estimated_unit_price,actual_unit_price)
    select v_new_version,inventory_item_id,quantity,unit_code,estimated_unit_price,actual_unit_price
    from public.requisition_items where requisition_id=v_req.id;

    update public.requisitions set current_version=current_version+1,updated_at=now() where id=v_req.id;
    insert into public.approval_audit_trail(
      organization_id,requisition_id,approver_id,approval_stage,action,previous_version_id,resulting_version_id,mandatory_reason
    ) values(v_org,v_req.id,v_uid,v_stage,'edited',v_prev_version,v_new_version,p_reason);

  elsif p_action='approved' and v_stage='manager' then
    if jsonb_typeof(p_actual_items)<>'array' or jsonb_array_length(p_actual_items)<>(
      select count(*) from public.requisition_items where requisition_id=v_req.id
    ) then raise exception 'The Manager must enter an actual unit price for every requisition item before approval.'; end if;

    if exists(select 1 from public.requisition_items ri where ri.requisition_id=v_req.id and not exists(
      select 1 from jsonb_array_elements(p_actual_items) a
      where (a->>'requisition_item_id')::uuid=ri.id and coalesce((a->>'actual_unit_price')::numeric,0)>0
    )) then raise exception 'The Manager must enter an actual unit price for every requisition item before approval.'; end if;

    if exists(select 1 from jsonb_array_elements(p_actual_items) a where coalesce((a->>'actual_unit_price')::numeric,0)<=0)
      then raise exception 'Actual unit prices must be greater than zero.'; end if;

    update public.requisition_items ri set actual_unit_price=(a->>'actual_unit_price')::numeric
    from jsonb_array_elements(p_actual_items) a
    where ri.id=(a->>'requisition_item_id')::uuid and ri.requisition_id=v_req.id;

    update public.requisition_version_items rvi set actual_unit_price=ri.actual_unit_price
    from public.requisition_items ri
    where rvi.version_id=v_prev_version and rvi.inventory_item_id=ri.inventory_item_id and ri.requisition_id=v_req.id;

    select jsonb_agg(jsonb_build_object(
      'requisition_item_id',ri.id,'inventory_item_id',ri.inventory_item_id,'quantity',ri.quantity,
      'actual_unit_price',ri.actual_unit_price,'actual_total',ri.actual_total
    ) order by ri.id) into v_actual_snapshot
    from public.requisition_items ri where ri.requisition_id=v_req.id;

    insert into public.approval_audit_trail(
      organization_id,requisition_id,approver_id,approval_stage,action,previous_version_id,resulting_version_id,actual_cost_snapshot
    ) values(v_org,v_req.id,v_uid,v_stage,'approved',v_prev_version,v_prev_version,v_actual_snapshot);

  else
    insert into public.approval_audit_trail(
      organization_id,requisition_id,approver_id,approval_stage,action,previous_version_id,resulting_version_id,mandatory_reason
    ) values(v_org,v_req.id,v_uid,v_stage,p_action::public.approval_action,v_prev_version,v_prev_version,nullif(trim(p_reason),''));
  end if;

  if p_action='rejected' then
    update public.requisitions set status='rejected',rejected_at=now(),rejection_reason=nullif(trim(p_reason),''),updated_at=now() where id=v_req.id;
    return jsonb_build_object('id',v_req.id,'status','rejected');
  end if;

  if v_stage='manager' then
    update public.requisitions set status='gm_pending',manager_approved_at=now(),updated_at=now() where id=v_req.id;
    perform public.create_role_notification('general_manager','requisition_manager_approved','Requisition awaiting GM approval','A requisition has passed the Manager checkpoint and needs your approval.','requisition',v_req.id);
    return jsonb_build_object('id',v_req.id,'status','gm_pending');
  end if;

  if v_stage='gm' then
    if exists(select 1 from public.requisition_items where requisition_id=v_req.id and coalesce(actual_unit_price,0)<=0)
      then raise exception 'This requisition is missing an actual unit price for one or more items.'; end if;
    update public.requisitions set status='ceo_pending',gm_approved_at=now(),updated_at=now() where id=v_req.id;
    perform public.create_role_notification('ceo','requisition_gm_approved','Requisition awaiting CEO approval','A requisition has passed the General Manager checkpoint and needs your final approval.','requisition',v_req.id);
    return jsonb_build_object('id',v_req.id,'status','ceo_pending');
  end if;

  if exists(select 1 from public.requisition_items where requisition_id=v_req.id and coalesce(actual_unit_price,0)<=0)
    then raise exception 'This requisition cannot generate a purchase order until every item has an actual unit price.'; end if;

  update public.requisitions set status='approved_po_generated',ceo_approved_at=now(),updated_at=now() where id=v_req.id;
  v_po_number:='PO-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||lpad(nextval('public.purchase_order_number_seq')::text,5,'0');
  perform set_config('app.ceo_po_generation','true',true);

  insert into public.purchase_orders(
    supplier,reference,status,ordered_at,notes,total,created_by,requisition_id,requisition_version_id,po_number,generation_method,generated_at
  )
  select null,v_req.requisition_number,'ordered',now(),v_req.notes,
    coalesce(sum(coalesce(rvi.quantity,0)*coalesce(rvi.actual_unit_price,0)),0),
    v_uid,v_req.id,rv.id,v_po_number,'ceo_approval',now()
  from public.requisition_versions rv left join public.requisition_version_items rvi on rvi.version_id=rv.id
  where rv.id=(select id from public.requisition_versions where requisition_id=v_req.id and version_number=v_req.current_version)
  group by rv.id returning id into v_po;

  insert into public.purchase_order_items(purchase_order_id,inventory_item_id,ordered_quantity,received_quantity,unit_cost)
  select v_po,inventory_item_id,quantity,0,coalesce(actual_unit_price,0)
  from public.requisition_version_items
  where version_id=(select id from public.requisition_versions where requisition_id=v_req.id and version_number=v_req.current_version);

  perform public.create_role_notification('owner','purchase_order_generated','Purchase order generated','CEO approval completed. A purchase order was generated automatically from the final approved requisition.','purchase_order',v_po);
  return jsonb_build_object('id',v_req.id,'status','approved_po_generated','purchase_order_id',v_po,'purchase_order_number',v_po_number);
end $$;

revoke all on function public.approve_requisition(uuid,text,jsonb,text,jsonb) from public;
grant execute on function public.approve_requisition(uuid,text,jsonb,text,jsonb) to authenticated;
