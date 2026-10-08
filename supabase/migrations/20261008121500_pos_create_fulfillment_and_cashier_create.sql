-- POS creation RPC with fulfillment method and cashier create permission.
create or replace function public.create_pos_order_v2(
  p_customer_name text,
  p_phone text,
  p_items jsonb,
  p_notes text default null,
  p_fulfillment_method text default 'dine_in'
)
returns uuid
language plpgsql
set search_path to public, private
as $function$
declare
  v_customer uuid; v_order uuid; v jsonb; v_item uuid; v_qty numeric; v_price numeric; v_total numeric:=0;
begin
  if not (private.has_permission('orders.manage') or private.has_permission('orders.create')) then raise exception 'Not authorized'; end if;
  if lower(coalesce(p_fulfillment_method,'')) not in ('dine_in','pickup','delivery') then raise exception 'Invalid fulfillment method'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'At least one item is required'; end if;
  if coalesce(trim(p_customer_name),'')<>'' or coalesce(trim(p_phone),'')<>'' then
    insert into public.customers(name,phone)
    values(nullif(trim(coalesce(p_customer_name,'')),''),nullif(trim(coalesce(p_phone,'')),''))
    returning id into v_customer;
  end if;
  insert into public.orders(customer_id,source,status,payment_status,total,created_by,customer_notes,fulfillment_method)
  values(v_customer,'pos','open','unpaid',0,(select auth.uid()),nullif(trim(coalesce(p_notes,'')),''),lower(p_fulfillment_method))
  returning id into v_order;
  for v in select * from jsonb_array_elements(p_items) loop
    v_item:=(v->>'id')::uuid; v_qty:=greatest(1,(v->>'quantity')::numeric);
    select price into v_price from public.menu_items where id=v_item and in_stock=true and price_on_request=false;
    if not found then raise exception 'Menu item unavailable or price on request'; end if;
    insert into public.order_items(order_id,menu_item_id,qty,unit_price,notes)
    values(v_order,v_item,v_qty,v_price,null);
    v_total:=v_total+v_qty*v_price;
  end loop;
  update public.orders set total=v_total where id=v_order;
  return v_order;
end;
$function$;

revoke all on function public.create_pos_order_v2(text,text,jsonb,text,text) from public,anon;
grant execute on function public.create_pos_order_v2(text,text,jsonb,text,text) to authenticated,service_role;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.name='cashier' and p.code='orders.create'
on conflict do nothing;
