-- Keep public personnel presentation limited to safe profile fields.
alter table public.team_positions
  add column if not exists public_avatar_url text,
  add column if not exists public_description text;

create or replace function public.sync_team_position_public_profile()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  update public.team_positions
  set public_avatar_url = new.avatar_url,
      public_description = new.background_info,
      updated_at = now()
  where staff_profile_id = new.id;
  return new;
end
$function$;

drop trigger if exists trg_sync_team_position_public_profile on public.profiles;
create trigger trg_sync_team_position_public_profile
after insert or update of avatar_url, background_info, full_name
on public.profiles
for each row
execute function public.sync_team_position_public_profile();

update public.team_positions tp
set public_avatar_url = p.avatar_url,
    public_description = p.background_info,
    updated_at = now()
from public.profiles p
where p.id = tp.staff_profile_id;
