create or replace view public.inventory_stock as
select
  i.id,
  i.name,
  i.unit,
  i.category,
  i.reorder_level,
  i.active,
  coalesce(sum(
    case
      when sm.movement_type = any (array['purchase','in','adjustment_in','return'])
        then sm.quantity
      when sm.movement_type = any (array['sale','out','usage','waste','adjustment_out'])
        then -sm.quantity
      else 0::numeric
    end
  ), 0::numeric) as current_stock,
  i.station_id,
  i.inventory_scope,
  ss.name as station_name
from public.inventory_items i
left join public.stock_movements sm on sm.item_id = i.id
left join public.service_stations ss on ss.id = i.station_id
group by i.id, i.name, i.unit, i.category, i.reorder_level, i.active, i.station_id, i.inventory_scope, ss.name;
