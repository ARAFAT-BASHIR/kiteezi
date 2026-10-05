-- Production requisition / approval / service-reporting mechanics
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now()
);

insert into public.organizations(name)
select 'Kiteezi Recreational Center'
where not exists (select 1 from public.organizations);

alter table public.profiles add column if not exists organization_id uuid;
update public.profiles set organization_id=(select id from public.organizations order by created_at limit 1) where organization_id is null;
alter table public.profiles alter column organization_id set not null;
do $$ begin
  alter table public.profiles add constraint profiles_organization_id_fkey foreign key (organization_id) references public.organizations(id);
exception when duplicate_object then null; end $$;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path=public,pg_catalog as $$
  select p.organization_id from public.profiles p where p.id=auth.uid() and p.active=true limit 1
$$;
revoke all on function public.current_organization_id() from public;
grant execute on function public.current_organization_id() to authenticated;

do $$ begin create type public.requisition_status as enum ('draft','manager_pending','gm_pending','ceo_pending','approved_po_generated','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.approval_action as enum ('approved','edited','rejected'); exception when duplicate_object then null; end $$;

create table if not exists public.requisitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  requisition_number text not null,
  requester_id uuid not null references public.profiles(id),
  status public.requisition_status not null default 'draft',
  current_version integer not null default 1,
  notes text,
  created_by uuid not null references public.profiles(id),
  submitted_at timestamptz,
  manager_approved_at timestamptz,
  gm_approved_at timestamptz,
  ceo_approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,requisition_number)
);

create table if not exists public.requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity numeric(14,3) not null check (quantity>0),
  unit_code text not null,
  estimated_unit_price numeric(14,2),
  created_at timestamptz not null default now()
);

create table if not exists public.requisition_versions (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.requisitions(id) on delete cascade,
  version_number integer not null,
  created_by uuid not null references public.profiles(id),
  stage text not null,
  change_reason text,
  created_at timestamptz not null default now(),
  unique(requisition_id,version_number)
);

create table if not exists public.requisition_version_items (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.requisition_versions(id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id),
  quantity numeric(14,3) not null check (quantity>0),
  unit_code text not null,
  estimated_unit_price numeric(14,2)
);

create table if not exists public.approval_audit_trail (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  requisition_id uuid not null references public.requisitions(id),
  approver_id uuid not null references public.profiles(id),
  approval_stage text not null check (approval_stage in ('manager','gm','ceo')),
  action public.approval_action not null,
  previous_version_id uuid references public.requisition_versions(id),
  resulting_version_id uuid references public.requisition_versions(id),
  mandatory_reason text,
  occurred_at timestamptz not null default now(),
  check (action<>'edited' or (mandatory_reason is not null and length(trim(mandatory_reason))>0))
);

create index if not exists requisitions_org_status_idx on public.requisitions(organization_id,status);
create index if not exists requisition_items_req_idx on public.requisition_items(requisition_id);
create index if not exists approval_audit_req_idx on public.approval_audit_trail(requisition_id,occurred_at desc);

alter table public.purchase_orders
  add column if not exists requisition_id uuid,
  add column if not exists requisition_version_id uuid,
  add column if not exists po_number text,
  add column if not exists generation_method text,
  add column if not exists generated_at timestamptz;

do $$ begin
  alter table public.purchase_orders add constraint purchase_orders_requisition_id_fkey foreign key (requisition_id) references public.requisitions(id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.purchase_orders add constraint purchase_orders_requisition_version_id_fkey foreign key (requisition_version_id) references public.requisition_versions(id);
exception when duplicate_object then null; end $$;

create unique index if not exists purchase_orders_requisition_unique on public.purchase_orders(requisition_id) where requisition_id is not null;
create unique index if not exists purchase_orders_po_number_unique on public.purchase_orders(po_number) where po_number is not null;
create sequence if not exists public.purchase_order_number_seq;

create or replace function public.guard_purchase_order_insert()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_status public.requisition_status;
begin
  if coalesce(current_setting('app.ceo_po_generation',true),'')<>'true' then
    raise exception 'Manual purchase order creation is prohibited. Purchase orders are generated only from final CEO approval.';
  end if;
  if new.requisition_id is null or new.requisition_version_id is null then
    raise exception 'Auto-generated purchase orders require a source requisition and approved version.';
  end if;
  select status into v_status from public.requisitions where id=new.requisition_id for update;
  if v_status<>'approved_po_generated' then raise exception 'Purchase order source requisition is not CEO approved.'; end if;
  new.generation_method:='ceo_approval';
  new.generated_at:=coalesce(new.generated_at,now());
  return new;
end $$;
drop trigger if exists trg_guard_purchase_order_insert on public.purchase_orders;
create trigger trg_guard_purchase_order_insert before insert on public.purchase_orders for each row execute function public.guard_purchase_order_insert();

create or replace function public.guard_purchase_order_update()
returns trigger language plpgsql as $$
begin
  if old.requisition_id is not null and new.requisition_id is distinct from old.requisition_id then raise exception 'Purchase order source requisition cannot be changed.'; end if;
  if old.requisition_version_id is not null and new.requisition_version_id is distinct from old.requisition_version_id then raise exception 'Purchase order source version cannot be changed.'; end if;
  return new;
end $$;
drop trigger if exists trg_guard_purchase_order_update on public.purchase_orders;
create trigger trg_guard_purchase_order_update before update on public.purchase_orders for each row execute function public.guard_purchase_order_update();
revoke insert on public.purchase_orders from anon,authenticated;
revoke insert on public.purchase_order_items from anon,authenticated;

create table if not exists public.service_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  staff_id uuid not null references public.profiles(id),
  item_id uuid not null references public.menu_items(id),
  quantity numeric(14,3) not null check (quantity>0),
  recorded_at timestamptz not null default now()
);
create index if not exists service_logs_org_time_idx on public.service_logs(organization_id,recorded_at desc);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.profiles(id),
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,endpoint)
);

alter table public.bookings add column if not exists booking_type text not null default 'ordinary';
update public.bookings b set booking_type='school_swimming'
where exists(select 1 from public.services s where s.id=b.service_id and lower(coalesce(s.name,'')) like '%school swimming%');

insert into public.permissions(code,description) values
 ('requisitions.view','View requisitions'),
 ('requisitions.create','Create requisitions'),
 ('requisitions.approve.manager','Approve or edit requisitions at Manager stage'),
 ('requisitions.approve.gm','Approve or edit requisitions at General Manager stage'),
 ('requisitions.approve.ceo','Approve or edit requisitions at CEO stage'),
 ('purchase_orders.view','View generated purchase orders'),
 ('purchase_orders.manage','Manage receiving/payment lifecycle of generated purchase orders'),
 ('service_logs.create','Record service quantities for accounting and service tallies'),
 ('bookings.view','View bookings without transactional controls'),
 ('reviews.view','View public reviews')
on conflict(code) do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.code in
('requisitions.view','requisitions.create','requisitions.approve.manager','purchase_orders.view','purchase_orders.manage','service_logs.create','bookings.view','reviews.view')
where r.name='manager' on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.code in
('requisitions.view','requisitions.create','requisitions.approve.gm','purchase_orders.view','purchase_orders.manage','service_logs.create','bookings.view','reviews.view')
where r.name='general_manager' on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.code in
('requisitions.view','requisitions.create','requisitions.approve.ceo','purchase_orders.view','purchase_orders.manage','service_logs.create','bookings.view','reviews.view')
where r.name in ('ceo','owner') on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p on p.code in
('requisitions.view','requisitions.create','service_logs.create','bookings.view','reviews.view','menu.manage')
where r.name in ('chef','waitstaff','head_swimming_coach') on conflict do nothing;

alter table public.requisitions enable row level security;
alter table public.requisition_items enable row level security;
alter table public.requisition_versions enable row level security;
alter table public.requisition_version_items enable row level security;
alter table public.approval_audit_trail enable row level security;
alter table public.service_logs enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists requisitions_select on public.requisitions;
create policy requisitions_select on public.requisitions for select to authenticated using (
 organization_id=public.current_organization_id() and (
 public.has_permission('requisitions.view') or public.has_permission('requisitions.create') or
 public.has_permission('requisitions.approve.manager') or public.has_permission('requisitions.approve.gm') or
 public.has_permission('requisitions.approve.ceo')));

drop policy if exists requisition_items_select on public.requisition_items;
create policy requisition_items_select on public.requisition_items for select to authenticated using (
 exists(select 1 from public.requisitions r where r.id=requisition_id and r.organization_id=public.current_organization_id() and public.has_permission('requisitions.view')));

drop policy if exists requisition_versions_select on public.requisition_versions;
create policy requisition_versions_select on public.requisition_versions for select to authenticated using (
 exists(select 1 from public.requisitions r where r.id=requisition_id and r.organization_id=public.current_organization_id() and public.has_permission('requisitions.view')));

drop policy if exists requisition_version_items_select on public.requisition_version_items;
create policy requisition_version_items_select on public.requisition_version_items for select to authenticated using (
 exists(select 1 from public.requisition_versions v join public.requisitions r on r.id=v.requisition_id where v.id=version_id and r.organization_id=public.current_organization_id() and public.has_permission('requisitions.view')));

drop policy if exists approval_audit_select on public.approval_audit_trail;
create policy approval_audit_select on public.approval_audit_trail for select to authenticated using (
 organization_id=public.current_organization_id() and public.has_permission('requisitions.view'));

drop policy if exists service_logs_select on public.service_logs;
create policy service_logs_select on public.service_logs for select to authenticated using (
 organization_id=public.current_organization_id() and (public.has_permission('service_logs.create') or public.has_permission('reports.view')));

drop policy if exists service_logs_insert on public.service_logs;
create policy service_logs_insert on public.service_logs for insert to authenticated with check (
 organization_id=public.current_organization_id() and staff_id=auth.uid() and public.has_permission('service_logs.create'));

drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (organization_id=public.current_organization_id() and user_id=auth.uid());
drop policy if exists push_subscriptions_write on public.push_subscriptions;
create policy push_subscriptions_write on public.push_subscriptions for all to authenticated using (organization_id=public.current_organization_id() and user_id=auth.uid()) with check (organization_id=public.current_organization_id() and user_id=auth.uid());

create or replace function public.create_requisition(p_items jsonb,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_uid uuid:=auth.uid(); v_org uuid:=public.current_organization_id(); v_req uuid; v_num text; v_item jsonb; v_version uuid;
begin
 if v_uid is null or v_org is null or not public.has_permission('requisitions.create') then raise exception 'You are not permitted to create requisitions.'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'A requisition must contain at least one item.'; end if;
 v_num:='REQ-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||substr(replace(v_uid::text,'-',''),1,6);
 insert into public.requisitions(organization_id,requisition_number,requester_id,status,current_version,notes,created_by,submitted_at)
 values(v_org,v_num,v_uid,'manager_pending',1,p_notes,v_uid,now()) returning id into v_req;
 insert into public.requisition_versions(requisition_id,version_number,created_by,stage) values(v_req,1,v_uid,'requester') returning id into v_version;
 for v_item in select * from jsonb_array_elements(p_items) loop
   if nullif(v_item->>'inventory_item_id','') is null or coalesce((v_item->>'quantity')::numeric,0)<=0 then raise exception 'Every requisition item requires a valid inventory item and positive quantity.'; end if;
   insert into public.requisition_items(requisition_id,inventory_item_id,quantity,unit_code,estimated_unit_price)
   values(v_req,(v_item->>'inventory_item_id')::uuid,(v_item->>'quantity')::numeric,
          coalesce(nullif(v_item->>'unit_code',''),(select unit from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid)),
          nullif(v_item->>'estimated_unit_price','')::numeric);
   insert into public.requisition_version_items(version_id,inventory_item_id,quantity,unit_code,estimated_unit_price)
   values(v_version,(v_item->>'inventory_item_id')::uuid,(v_item->>'quantity')::numeric,
          coalesce(nullif(v_item->>'unit_code',''),(select unit from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid)),
          nullif(v_item->>'estimated_unit_price','')::numeric);
 end loop;
 return jsonb_build_object('id',v_req,'status','manager_pending','requisition_number',v_num);
end $$;
revoke all on function public.create_requisition(jsonb,text) from public;
grant execute on function public.create_requisition(jsonb,text) to authenticated;

create or replace function public.create_role_notification(p_role text,p_type text,p_title text,p_message text,p_reference_type text,p_reference_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_count integer;
begin
 insert into public.notifications(recipient_user_id,type,title,message,reference_type,reference_id)
 select p.id,p_type,p_title,p_message,p_reference_type,p_reference_id from public.profiles p
 where p.active=true and p.role=p_role and p.organization_id=public.current_organization_id();
 get diagnostics v_count=row_count; return v_count;
end $$;
revoke all on function public.create_role_notification(text,text,text,text,text,uuid) from public;
grant execute on function public.create_role_notification(text,text,text,text,text,uuid) to authenticated;

create or replace function public.approve_requisition(p_requisition_id uuid,p_action text,p_items jsonb default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare
 v_uid uuid:=auth.uid(); v_org uuid:=public.current_organization_id(); v_req public.requisitions%rowtype;
 v_role text; v_stage text; v_prev_version uuid; v_new_version uuid; v_item jsonb; v_po uuid; v_po_number text;
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
 if p_action='edited' then
   if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'A reason is mandatory whenever an approver edits a requisition.'; end if;
   if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Edited requisitions must contain at least one item.'; end if;
 end if;
 select id into v_prev_version from public.requisition_versions where requisition_id=v_req.id and version_number=v_req.current_version;
 if p_action='edited' then
   v_new_version:=gen_random_uuid();
   insert into public.requisition_versions(id,requisition_id,version_number,created_by,stage,change_reason)
   values(v_new_version,v_req.id,v_req.current_version+1,v_uid,v_stage,p_reason);
   delete from public.requisition_items where requisition_id=v_req.id;
   for v_item in select * from jsonb_array_elements(p_items) loop
     if coalesce((v_item->>'quantity')::numeric,0)<=0 then raise exception 'Edited quantities must be positive.'; end if;
     insert into public.requisition_items(requisition_id,inventory_item_id,quantity,unit_code,estimated_unit_price)
     values(v_req.id,(v_item->>'inventory_item_id')::uuid,(v_item->>'quantity')::numeric,
            coalesce(nullif(v_item->>'unit_code',''),(select unit from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid)),
            nullif(v_item->>'estimated_unit_price','')::numeric);
     insert into public.requisition_version_items(version_id,inventory_item_id,quantity,unit_code,estimated_unit_price)
     values(v_new_version,(v_item->>'inventory_item_id')::uuid,(v_item->>'quantity')::numeric,
            coalesce(nullif(v_item->>'unit_code',''),(select unit from public.inventory_items where id=(v_item->>'inventory_item_id')::uuid)),
            nullif(v_item->>'estimated_unit_price','')::numeric);
   end loop;
   update public.requisitions set current_version=current_version+1,updated_at=now() where id=v_req.id;
   insert into public.approval_audit_trail(organization_id,requisition_id,approver_id,approval_stage,action,previous_version_id,resulting_version_id,mandatory_reason)
   values(v_org,v_req.id,v_uid,v_stage,'edited',v_prev_version,v_new_version,p_reason);
 else
   insert into public.approval_audit_trail(organization_id,requisition_id,approver_id,approval_stage,action,previous_version_id,resulting_version_id,mandatory_reason)
   values(v_org,v_req.id,v_uid,v_stage,p_action::public.approval_action,v_prev_version,v_prev_version,nullif(trim(p_reason),''));
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
   update public.requisitions set status='ceo_pending',gm_approved_at=now(),updated_at=now() where id=v_req.id;
   perform public.create_role_notification('ceo','requisition_gm_approved','Requisition awaiting CEO approval','A requisition has passed the General Manager checkpoint and needs your final approval.','requisition',v_req.id);
   return jsonb_build_object('id',v_req.id,'status','ceo_pending');
 end if;
 update public.requisitions set status='approved_po_generated',ceo_approved_at=now(),updated_at=now() where id=v_req.id;
 v_po_number:='PO-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||lpad(nextval('public.purchase_order_number_seq')::text,5,'0');
 perform set_config('app.ceo_po_generation','true',true);
 insert into public.purchase_orders(supplier,reference,status,ordered_at,notes,total,created_by,requisition_id,requisition_version_id,po_number,generation_method,generated_at)
 select null,v_req.requisition_number,'ordered',now(),v_req.notes,
        coalesce(sum(coalesce(rvi.quantity,0)*coalesce(rvi.estimated_unit_price,0)),0),v_uid,v_req.id,rv.id,v_po_number,'ceo_approval',now()
 from public.requisition_versions rv left join public.requisition_version_items rvi on rvi.version_id=rv.id
 where rv.id=(select id from public.requisition_versions where requisition_id=v_req.id and version_number=v_req.current_version)
 group by rv.id returning id into v_po;
 insert into public.purchase_order_items(purchase_order_id,inventory_item_id,ordered_quantity,received_quantity,unit_cost)
 select v_po,inventory_item_id,quantity,0,coalesce(estimated_unit_price,0)
 from public.requisition_version_items
 where version_id=(select id from public.requisition_versions where requisition_id=v_req.id and version_number=v_req.current_version);
 perform public.create_role_notification('owner','purchase_order_generated','Purchase order generated','CEO approval completed. A purchase order was generated automatically from the final approved requisition.','purchase_order',v_po);
 return jsonb_build_object('id',v_req.id,'status','approved_po_generated','purchase_order_id',v_po,'purchase_order_number',v_po_number);
end $$;
revoke all on function public.approve_requisition(uuid,text,jsonb,text) from public;
grant execute on function public.approve_requisition(uuid,text,jsonb,text) to authenticated;

create or replace function public.record_service_log(p_item_id uuid,p_quantity numeric)
returns public.service_logs language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_row public.service_logs;
begin
 if auth.uid() is null or not public.has_permission('service_logs.create') then raise exception 'You are not permitted to record service logs.'; end if;
 if p_quantity<=0 then raise exception 'Quantity must be positive.'; end if;
 insert into public.service_logs(organization_id,staff_id,item_id,quantity)
 values(public.current_organization_id(),auth.uid(),p_item_id,p_quantity) returning * into v_row;
 return v_row;
end $$;
revoke all on function public.record_service_log(uuid,numeric) from public;
grant execute on function public.record_service_log(uuid,numeric) to authenticated;

create or replace function public.block_approval_audit_mutation()
returns trigger language plpgsql as $$
begin raise exception 'Approval audit history is immutable.'; end $$;
drop trigger if exists trg_block_approval_audit_update on public.approval_audit_trail;
drop trigger if exists trg_block_approval_audit_delete on public.approval_audit_trail;
create trigger trg_block_approval_audit_update before update on public.approval_audit_trail for each row execute function public.block_approval_audit_mutation();
create trigger trg_block_approval_audit_delete before delete on public.approval_audit_trail for each row execute function public.block_approval_audit_mutation();

create or replace view public.inventory_physical_position as
select i.id inventory_item_id,i.name,i.unit,
 coalesce(sum(case when sm.movement_type='in' and lower(coalesce(sm.reason,''))='opening balance' then sm.quantity else 0 end),0) opening_stock,
 coalesce(sum(case when sm.movement_type='in' and lower(coalesce(sm.reason,''))<>'opening balance' then sm.quantity else 0 end),0) purchases_received,
 coalesce(sum(case when sm.movement_type='out' and lower(coalesce(sm.reason,'')) like 'order %' then sm.quantity else 0 end),0) bom_consumption,
 coalesce(sum(case when sm.movement_type='out' and lower(coalesce(sm.reason,'')) like 'waste%' then sm.quantity else 0 end),0) wastage,
 coalesce(sum(case when sm.movement_type='out' and lower(coalesce(sm.reason,'')) like '%taken home%' then sm.quantity else 0 end),0) staff_taken_home,
 coalesce(sum(case when sm.movement_type='out' and lower(coalesce(sm.reason,'')) like 'audit adjustment%' then sm.quantity else 0 end),0) audit_adjustment,
 coalesce(sum(case when sm.movement_type='in' then sm.quantity else -sm.quantity end),0) current_stock
from public.inventory_items i left join public.stock_movements sm on sm.item_id=i.id
group by i.id,i.name,i.unit;
grant select on public.inventory_physical_position to authenticated;

drop policy if exists purchase_orders_select_generated on public.purchase_orders;
create policy purchase_orders_select_generated on public.purchase_orders for select to authenticated using (public.has_permission('purchase_orders.view') or public.has_permission('purchase_orders.manage'));
drop policy if exists purchase_orders_update_generated on public.purchase_orders;
create policy purchase_orders_update_generated on public.purchase_orders for update to authenticated using (public.has_permission('purchase_orders.manage')) with check (public.has_permission('purchase_orders.manage'));
drop policy if exists purchase_order_items_select_generated on public.purchase_order_items;
create policy purchase_order_items_select_generated on public.purchase_order_items for select to authenticated using (exists(select 1 from public.purchase_orders po where po.id=purchase_order_id and (public.has_permission('purchase_orders.view') or public.has_permission('purchase_orders.manage'))));
drop policy if exists purchase_order_items_update_generated on public.purchase_order_items;
create policy purchase_order_items_update_generated on public.purchase_order_items for update to authenticated using (public.has_permission('purchase_orders.manage')) with check (public.has_permission('purchase_orders.manage'));
