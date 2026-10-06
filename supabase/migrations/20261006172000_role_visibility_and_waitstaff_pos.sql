-- Role/UI and operational permission hardening applied to live Supabase.
-- Intentionally does NOT enable leaked-password protection and does NOT alter intentional SECURITY DEFINER RPCs.

delete from public.role_permissions
where permission_id='76f727e7-1cf2-43f1-b7cc-edcda534c357'
and role_id in (
 select id from public.roles
 where name in ('bartender','chef','head_chef','head_swimming_coach','lifeguard','swimming_manager')
);

delete from public.role_permissions
where role_id='a6b31507-a44f-4d3f-9b67-295c61d40606'
and permission_id in ('ba7f1e4f-e1e0-422a-8585-b3114d4d4cb2','d5af700e-d4e3-4340-bb98-8c7d9b21306e');

drop policy if exists shared_pool_menu_rules_staff_select on public.shared_pool_menu_rules;
create policy shared_pool_menu_rules_staff_select
on public.shared_pool_menu_rules for select to authenticated
using (
 private.has_permission('recipes.view'::text)
 or private.has_permission('recipes.manage'::text)
 or private.has_permission('menu.manage'::text)
);

create or replace function public.create_pos_order(p_customer_name text,p_phone text,p_items jsonb,p_notes text default null)
returns uuid language plpgsql set search_path to public, private
as $function$
declare v_customer uuid;v_order uuid;v jsonb;v_item uuid;v_qty numeric;v_price numeric;v_total numeric:=0;
begin
 if not (private.has_permission('orders.manage') or private.has_permission('orders.create')) then raise exception 'Not authorized'; end if;
 if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'At least one item is required'; end if;
 if coalesce(trim(p_customer_name),'')<>'' or coalesce(trim(p_phone),'')<>'' then
  insert into public.customers(name,phone) values(nullif(trim(coalesce(p_customer_name,'')),''),nullif(trim(coalesce(p_phone,'')),'')) returning id into v_customer;
 end if;
 insert into public.orders(customer_id,source,status,payment_status,total,created_by,customer_notes)
 values(v_customer,'pos','open','unpaid',0,(select auth.uid()),nullif(trim(coalesce(p_notes,'')),''))
 returning id into v_order;
 for v in select * from jsonb_array_elements(p_items) loop
  v_item:=(v->>'id')::uuid; v_qty:=greatest(1,(v->>'quantity')::numeric);
  select price into v_price from public.menu_items where id=v_item and in_stock=true and price_on_request=false;
  if not found then raise exception 'Menu item unavailable or price on request'; end if;
  insert into public.order_items(order_id,menu_item_id,qty,unit_price,notes) values(v_order,v_item,v_qty,v_price,null);
  v_total:=v_total+v_qty*v_price;
 end loop;
 update public.orders set total=v_total where id=v_order;
 return v_order;
end;$function$;
