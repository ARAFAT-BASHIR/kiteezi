-- Enforce the requisition flow: requester -> Manager -> CEO -> Purchase Order.
-- Preserve actual-price checks, version history, audit trail, and approval notifications.

create or replace function public.create_requisition(p_items jsonb, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.current_organization_id();
  v_req uuid;
  v_num text;
  v_item jsonb;
  v_version uuid;
  v_department text;
  v_inventory_item uuid;
  v_unit text;
  v_estimated numeric;
begin
  if v_uid is null or v_org is null or not public.has_permission('requisitions.create') then
    raise exception 'You are not permitted to create requisitions.';
  end if;

  select tp.department
    into v_department
  from public.profiles p
  left join public.team_positions tp on tp.id = p.position_id
  where p.id = v_uid
    and p.active = true
    and p.organization_id = v_org;

  if nullif(trim(coalesce(v_department, '')), '') is null then
    raise exception 'Your account is not assigned to a department.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A requisition must contain at least one item.';
  end if;

  v_num := 'REQ-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS') || '-' ||
    substr(replace(v_uid::text, '-', ''), 1, 6);

  insert into public.requisitions(
    organization_id, requisition_number, requester_id, status, current_version,
    notes, created_by, submitted_at, destination_department
  )
  values (
    v_org, v_num, v_uid, 'manager_pending', 1,
    nullif(trim(coalesce(p_notes, '')), ''), v_uid, now(), v_department
  )
  returning id into v_req;

  insert into public.requisition_versions(
    requisition_id, version_number, created_by, stage
  )
  values (v_req, 1, v_uid, 'requester')
  returning id into v_version;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(v_item->>'inventory_item_id', '') is null
       or coalesce(nullif(v_item->>'quantity', '')::numeric, 0) <= 0 then
      raise exception 'Every requisition item requires a valid inventory item and positive quantity.';
    end if;

    v_inventory_item := (v_item->>'inventory_item_id')::uuid;
    v_estimated := nullif(v_item->>'estimated_unit_price', '')::numeric;
    if v_estimated < 0 then
      raise exception 'Estimated unit prices cannot be negative.';
    end if;

    select ii.unit into v_unit
    from public.inventory_items ii
    where ii.id = v_inventory_item
      and ii.active = true;

    if not found then
      raise exception 'One of the selected inventory items is no longer available.';
    end if;

    insert into public.requisition_items(
      requisition_id, inventory_item_id, quantity, unit_code,
      estimated_unit_price, actual_unit_price
    )
    values (
      v_req, v_inventory_item, (v_item->>'quantity')::numeric,
      coalesce(nullif(v_item->>'unit_code', ''), v_unit),
      v_estimated, null
    );

    insert into public.requisition_version_items(
      version_id, inventory_item_id, quantity, unit_code,
      estimated_unit_price, actual_unit_price
    )
    values (
      v_version, v_inventory_item, (v_item->>'quantity')::numeric,
      coalesce(nullif(v_item->>'unit_code', ''), v_unit),
      v_estimated, null
    );
  end loop;

  perform public.create_role_notification(
    'manager',
    'requisition_submitted',
    'Requisition awaiting review',
    'A department requisition is ready for review and actual unit-price entry.',
    'requisition',
    v_req
  );

  return jsonb_build_object(
    'id', v_req,
    'status', 'manager_pending',
    'requisition_number', v_num,
    'destination_department', v_department
  );
end
$function$;

revoke all on function public.create_requisition(jsonb, text) from public, anon;
grant execute on function public.create_requisition(jsonb, text) to authenticated;

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
  v_stage:=case v_req.status when 'manager_pending' then 'manager' when 'ceo_pending' then 'ceo' else null end;
  if v_stage is null then raise exception 'This requisition is not awaiting an approval.'; end if;
  if v_stage='manager' and (v_role<>'manager' or not public.has_permission('requisitions.approve.manager')) then raise exception 'Only an authorized Manager can approve this stage.'; end if;
  if v_stage='ceo' and (v_role not in ('ceo','owner') or not public.has_permission('requisitions.approve.ceo')) then raise exception 'Only an authorized CEO can approve this stage.'; end if;
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
    update public.requisitions set status='ceo_pending',manager_approved_at=now(),updated_at=now() where id=v_req.id;
    perform public.create_role_notification('ceo','requisition_manager_approved','Requisition awaiting CEO approval','A requisition has passed the Manager checkpoint and needs your final approval.','requisition',v_req.id);
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

-- The General Manager is view-only and must not be able to create requisitions.
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.name = 'general_manager'
  and p.code = 'requisitions.create';
