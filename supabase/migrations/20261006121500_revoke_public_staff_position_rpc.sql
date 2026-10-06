-- Ensure the internal staff-position synchronizer is not executable by PUBLIC.
revoke execute on function public.sync_staff_position_assignment() from public;