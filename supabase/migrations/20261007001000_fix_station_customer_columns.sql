create or replace function public.get_station_order_details(p_station text)
returns table(order_id uuid,created_at timestamptz,source text,customer_name text,customer_phone text,fulfillment_method text,order_status text,station_id uuid,station_name text,station_status text,cancellation_reason text,cancelled_at timestamptz,items jsonb)
language plpgsql security definer set search_path=public,private,pg_catalog,pg_temp as $$
begin
if lower(p_station)='barista' then if not private.has_permission('orders.station_barista') then raise exception 'Not authorized'; end if;
elsif lower(p_station)='kitchen' then if not private.has_permission('orders.station_kitchen') then raise exception 'Not authorized'; end if;
else raise exception 'Unknown station %',p_station; end if;
return query
select o.id,o.created_at,o.source,coalesce(c.name,'Customer')::text,c.phone::text,o.fulfillment_method,o.status,s.id,s.name,osp.status,osp.cancellation_reason,osp.cancelled_at,
coalesce((select jsonb_agg(jsonb_build_object('id',oi.id,'menu_item_id',oi.menu_item_id,'name',coalesce(oi.item_name_snapshot,mi.name),'qty',oi.qty,'unit_price',oi.unit_price,'notes',oi.notes) order by oi.id) from public.order_items oi join public.menu_items mi on mi.id=oi.menu_item_id where oi.order_id=o.id and mi.station_id=s.id),'[]'::jsonb)
from public.order_station_progress osp join public.orders o on o.id=osp.order_id join public.service_stations s on s.id=osp.station_id and s.active left join public.customers c on c.id=o.customer_id
where lower(s.name)=lower(p_station) and o.status not in ('cancelled','completed') order by o.created_at asc; end $$;
revoke all on function public.get_station_order_details(text) from public,anon;
grant execute on function public.get_station_order_details(text) to authenticated,service_role;