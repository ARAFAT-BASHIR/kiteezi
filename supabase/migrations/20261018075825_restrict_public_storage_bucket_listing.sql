-- Public clients may read approved objects through storage.objects policies,
-- but must not enumerate the gallery/site-media bucket list.
DO $migration$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'buckets'
      AND ('anon' = ANY(roles) OR 'public' = ANY(roles))
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(gallery-public|site-media)'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.buckets', p.policyname);
  END LOOP;
END
$migration$;
