-- IGDC/MARU Social Network Candidate Queue
-- Run once in Supabase SQL Editor. Runtime functions use service_role only.

create table if not exists public.social_candidates (
  id text primary key,
  section_key text not null check (section_key in (
    'social-youtube', 'social-instagram', 'social-tiktok', 'social-facebook',
    'social-wechat', 'social-weibo', 'social-pinterest', 'social-reddit', 'social-twitter'
  )),
  platform text not null check (platform in (
    'youtube', 'instagram', 'tiktok', 'facebook', 'wechat', 'weibo', 'pinterest', 'reddit', 'twitter'
  )),
  title text not null,
  creator_name text,
  creator_handle text,
  source_url text not null,
  embed_url text,
  thumbnail_url text,
  description text,
  language text default 'und',
  region text,
  public_access boolean default false,
  login_required boolean default false,
  access_status text default 'unknown',
  display_mode text default 'link_card',
  ad_control text default 'platform_controlled',
  platform_account_dependent boolean default true,
  external_membership_controlled boolean default true,
  maru_membership_overrides_external_ads boolean default false,
  premium_benefit_platform_controlled boolean default true,
  safety_score numeric default 0,
  quality_score numeric default 0,
  engagement_score numeric default 0,
  revenue_score numeric default 0,
  locale_score numeric default 0,
  trust_score numeric default 0,
  rotation_score numeric default 0,
  risk_level text default 'medium',
  review_status text default 'pending',
  verification_status text default 'web_verification_required',
  candidate_only boolean default true,
  seed_content boolean default false,
  rotation_eligible boolean default false,
  evidence jsonb default '{}'::jsonb,
  raw jsonb default '{}'::jsonb,
  review_note text,
  blocked_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  approved_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_social_candidates_section on public.social_candidates(section_key);
create index if not exists idx_social_candidates_platform on public.social_candidates(platform);
create index if not exists idx_social_candidates_review on public.social_candidates(review_status, verification_status);
create index if not exists idx_social_candidates_rotation on public.social_candidates(section_key, rotation_score desc);
create index if not exists idx_social_candidates_updated on public.social_candidates(updated_at desc);
create index if not exists idx_social_candidates_public_access on public.social_candidates(public_access, login_required);

create table if not exists public.social_snapshot_releases (
  id bigserial primary key,
  release_id text unique,
  status text default 'draft',
  generated_by text,
  rotation_salt text,
  section_counts jsonb default '{}'::jsonb,
  snapshot_hash text,
  notes text,
  created_at timestamptz default now()
);

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.social_candidates to service_role;
grant select, insert, update, delete on table public.social_snapshot_releases to service_role;

grant usage on schema public to authenticated;
grant select on table public.social_candidates to authenticated;
grant select on table public.social_snapshot_releases to authenticated;

-- STEP5/FULL: release snapshot storage columns for rotation/publish previews.
alter table public.social_snapshot_releases
  add column if not exists snapshot jsonb,
  add column if not exists release_payload jsonb;

create index if not exists idx_social_snapshot_releases_hash on public.social_snapshot_releases(snapshot_hash);
create index if not exists idx_social_snapshot_releases_created on public.social_snapshot_releases(created_at desc);

-- Keep service-role write access after table/column changes.
grant select, insert, update, delete on table public.social_snapshot_releases to service_role;
grant select on table public.social_snapshot_releases to authenticated;
