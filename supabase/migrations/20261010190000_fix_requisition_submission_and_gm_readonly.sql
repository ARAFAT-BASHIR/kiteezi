-- Correct requisition submission so it enters the required approval workflow.
-- A requester estimate must never be treated as an actual price or generate a PO.
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

    if not exists (
      select 1 from public.inventory_items ii
      where ii.id = (v_item->>'inventory_item_id')::uuid
        and ii.active = true
    ) then
      raise exception 'One of the selected inventory items is no longer available.';
    end if;

    insert into public.requisition_items(
      requisition_id, inventory_item_id, quantity, unit_code,
      estimated_unit_price, actual_unit_price
    )
    select
      v_req,
      ii.id,
      (v_item->>'quantity')::numeric,
      coalesce(nullif(v_item->>'unit_code', ''), ii.unit),
      case
        when nullif(v_item->>'estimated_unit_price', '') is null then null
        when (v_item->>'estimated_unit_price')::numeric < 0 then
          null
        else (v_item->>'estimated_unit_price')::numeric
      end,
      null
    from public.inventory_items ii
    where ii.id = (v_item->>'inventory_item_id')::uuid
      and ii.active = true;

    if not found then
      raise exception 'One of the selected inventory items is no longer available.';
    end if;

    insert into public.requisition_version_items(
      version_id, inventory_item_id, quantity, unit_code,
      estimated_unit_price, actual_unit_price
    )
    select
      v_version, ri.inventory_item_id, ri.quantity, ri.unit_code,
      ri.estimated_unit_price, null
    from public.requisition_items ri
    where ri.requisition_id = v_req
      and ri.inventory_item_id = (v_item->>'inventory_item_id')::uuid;
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

-- The General Manager is view-only and must not be able to create requisitions.
delete from public.role_permissions rp
using public.roles r, public.permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.name = 'general_manager'
  and p.code = 'requisitions.create';
