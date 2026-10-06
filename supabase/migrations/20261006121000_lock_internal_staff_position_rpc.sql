-- Remove anonymous execution from an internal staff-position synchronizer.
-- It is invoked by database triggers and must not be exposed as a public RPC.

revoke execute on function public.sync_staff_position_assignment() from anon;
revoke execute on function public.sync_staff_position_assignment() from authenticated;