create or replace function private.initialize_order_station_progress(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
begin
  insert into public.order_station_progress(order_id,station_id,status)
  select oi.order_id,mi.station_id,
    case when count(*) filter (where lower(coalesce(mc.name,'')) not in ('beers','beer','soft drinks','soft drink'))=0
      then 'complete' else 'waiting' end
  from public.order_items oi
  join public.menu_items mi on mi.id=oi.menu_item_id
  join public.service_stations ss on ss.id=mi.station_id and ss.active
  left join public.menu_categories mc on mc.id=mi.category_id
  where oi.order_id=p_order_id and mi.station_id is not null
  group by oi.order_id,mi.station_id
  on conflict(order_id,station_id) do nothing;
end;
$function$;

create or replace function public.notify_staff_order_status()
returns trigger language plpgsql security definer set search_path=public,pg_catalog
as $function$
declare v_title text; v_message text;
begin
  if new.source <> 'pos' or new.created_by is null or old.status=new.status then return new; end if;
  if new.status='confirmed' then
    v_title:='Order confirmed';
    v_message:='Order #'||upper(left(new.id::text,8))||' has been confirmed and sent to the required stations.';
  elsif new.status='cancelled' and old.status in ('pending','open') then
    v_title:='Order rejected';
    v_message:='Order #'||upper(left(new.id::text,8))||' was rejected by the manager.';
  elsif new.status='completed' then
    v_title:='Order completed';
    v_message:='Order #'||upper(left(new.id::text,8))||' has been completed.';
  else return new;
  end if;
  insert into public.notifications(recipient_user_id,type,title,message,reference_type,reference_id,is_read,created_at)
  values(new.created_by,'order',v_title,v_message,'order',new.id,false,now())
  on conflict do nothing;
  return new;
end;
$function$;

create or replace function public.notify_order_station_completion()
returns trigger language plpgsql security definer set search_path=public,pg_catalog
as $function$
declare v_source text; v_created_by uuid; v_station_name text; v_all_complete boolean; v_order_label text;
begin
  if new.status<>'complete' or old.status='complete' then return new; end if;
  select o.source,o.created_by,upper(left(o.id::text,8)) into v_source,v_created_by,v_order_label
  from public.orders o where o.id=new.order_id;
  select name into v_station_name from public.service_stations where id=new.station_id;

  if v_source='pos' and v_created_by is not null then
    insert into public.notifications(recipient_user_id,type,title,message,reference_type,reference_id,is_read,created_at)
    values(v_created_by,'order_station','Station completed',
      'Order #'||v_order_label||' — '||coalesce(v_station_name,'Station')||' completed.',
      'order',new.order_id,false,now())
    on conflict do nothing;
  end if;

  select not exists(select 1 from public.order_station_progress p where p.order_id=new.order_id and p.status<>'complete')
  into v_all_complete;
  if v_all_complete then
    insert into public.notifications(recipient_user_id,type,title,message,reference_type,reference_id,is_read,created_at)
    select p.id,'order_ready','Order ready for final completion',
      'Order #'||v_order_label||' has completed all required stations.',
      'order',new.order_id,false,now()
    from public.profiles p
    where p.active=true and p.role in ('manager','general_manager','owner')
      and p.organization_id=(select pr.organization_id from public.profiles pr where pr.id=coalesce(v_created_by,auth.uid()))
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_notify_staff_order_status on public.orders;
create trigger trg_notify_staff_order_status after update of status on public.orders
for each row execute function public.notify_staff_order_status();

drop trigger if exists trg_notify_order_station_completion on public.order_station_progress;
create trigger trg_notify_order_station_completion after insert or update of status on public.order_station_progress
for each row execute function public.notify_order_station_completion();

revoke all on function public.notify_staff_order_status() from public,anon,authenticated;
revoke all on function public.notify_order_station_completion() from public,anon,authenticated;