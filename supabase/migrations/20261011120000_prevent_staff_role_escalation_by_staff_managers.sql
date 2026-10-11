create or replace function public.admin_update_staff_profile(
  p_target_id uuid,
  p_full_name text,
  p_phone text,
  p_avatar_url text,
  p_background_info text,
  p_role text,
  p_position_id uuid,
  p_employment_type text,
  p_pay_frequency text,
  p_supervisor_profile_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_catalog, pg_temp
as $function$
declare
  v_org uuid;
  v_target_org uuid;
  v_actor_role text;
  v_target_role text;
  v_allowed boolean;
begin
  select organization_id, role
    into v_org, v_actor_role
  from public.profiles
  where id = auth.uid() and active = true;

  v_allowed := coalesce(v_actor_role = 'owner', false)
    or private.has_permission('staff.manage');

  if not v_allowed then
    raise exception 'You do not have permission to update staff profiles.' using errcode = '42501';
  end if;

  if p_target_id is null then
    raise exception 'The staff profile was not specified.';
  end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then
    raise exception 'Full name is required.';
  end if;
  if nullif(trim(coalesce(p_role, '')), '') is null then
    raise exception 'A Login / Access Role is required.';
  end if;

  select organization_id, role
    into v_target_org, v_target_role
  from public.profiles
  where id = p_target_id;

  if v_target_org is null then
    raise exception 'Staff profile could not be found.';
  end if;
  if v_target_org is distinct from v_org then
    raise exception 'That staff member belongs to another organization.' using errcode = '42501';
  end if;
  if v_actor_role <> 'owner' and v_target_role = 'owner' then
    raise exception 'Owner accounts cannot be changed by this role.' using errcode = '42501';
  end if;
  if v_actor_role <> 'owner' and lower(trim(p_role)) = 'owner' then
    raise exception 'Only the owner can assign the Owner role.' using errcode = '42501';
  end if;
  if v_actor_role <> 'owner' and lower(trim(p_role)) is distinct from lower(trim(v_target_role)) then
    raise exception 'Only the owner can change staff access roles.' using errcode = '42501';
  end if;

  if p_position_id is not null and not exists (
    select 1 from public.team_positions where id = p_position_id
  ) then
    raise exception 'The selected public position could not be found.';
  end if;
  if p_supervisor_profile_id is not null and not exists (
    select 1 from public.profiles
    where id = p_supervisor_profile_id and organization_id = v_org
  ) then
    raise exception 'The selected supervisor could not be found.';
  end if;

  update public.profiles
  set full_name = trim(p_full_name),
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      avatar_url = nullif(trim(coalesce(p_avatar_url, '')), ''),
      background_info = nullif(trim(coalesce(p_background_info, '')), ''),
      role = trim(p_role),
      position_id = p_position_id,
      employment_type = p_employment_type,
      pay_frequency = p_pay_frequency,
      supervisor_profile_id = p_supervisor_profile_id,
      active = coalesce(p_active, true)
  where id = p_target_id;

  return true;
end;
$function$;
