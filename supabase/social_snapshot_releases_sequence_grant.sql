-- IGDC Social release audit persistence repair
-- Required only once when PostgREST reports:
--   permission denied for sequence social_snapshot_releases_id_seq
-- The Netlify Functions server uses the Supabase service_role key.  Do not
-- grant this sequence to anon; public clients never need direct release writes.
GRANT USAGE, SELECT ON SEQUENCE public.social_snapshot_releases_id_seq TO service_role;
