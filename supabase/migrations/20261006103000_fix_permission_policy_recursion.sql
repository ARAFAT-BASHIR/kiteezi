-- Prevent recursive RLS evaluation from legacy unqualified permission helpers.
-- Keep the private SECURITY DEFINER helper as the single permission evaluator.
do $$
declare
  p record;
  q text;
  w text;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname='public'
      and (
        position('has_permission(' in coalesce(qual,'')) > 0
        or position('has_permission(' in coalesce(with_check,'')) > 0
      )
      and position('private.has_permission(' in coalesce(qual,'')) = 0
      and position('private.has_permission(' in coalesce(with_check,'')) = 0
  loop
    q := case when p.qual is null then null
              else replace(p.qual, 'has_permission(', 'private.has_permission(') end;
    w := case when p.with_check is null then null
              else replace(p.with_check, 'has_permission(', 'private.has_permission(') end;

    if q is not null and w is not null then
      execute format('alter policy %I on %I.%I using (%s) with check (%s)',
        p.policyname,p.schemaname,p.tablename,q,w);
    elsif q is not null then
      execute format('alter policy %I on %I.%I using (%s)',
        p.policyname,p.schemaname,p.tablename,q);
    elsif w is not null then
      execute format('alter policy %I on %I.%I with check (%s)',
        p.policyname,p.schemaname,p.tablename,w);
    end if;
  end loop;
end $$;