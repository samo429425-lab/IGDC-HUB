-- Optional IGDC / MARU search exposure execution audit.
-- Execute once in Supabase SQL Editor; this is separate from Paddle and Android payment SQL.
-- Stores only sanitized automation metadata. Do NOT store URL lists, tokens, search queries or user data.
CREATE TABLE IF NOT EXISTS public.igdc_search_exposure_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at timestamptz NOT NULL,
  result_status text NOT NULL,
  registry_hash text,
  changed_count integer NOT NULL DEFAULT 0,
  submitted_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  partial_count integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS igdc_search_exposure_runs_run_at_idx
  ON public.igdc_search_exposure_runs(run_at DESC);
ALTER TABLE public.igdc_search_exposure_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.igdc_search_exposure_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.igdc_search_exposure_runs TO service_role;
-- identity sequence permissions are required when using the Supabase REST API
GRANT USAGE, SELECT ON SEQUENCE public.igdc_search_exposure_runs_id_seq TO service_role;
-- Do not create browser-facing RLS policies: only service_role can read or insert.
