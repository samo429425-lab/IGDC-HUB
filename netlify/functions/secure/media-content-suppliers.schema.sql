-- IGDC/MARU Media Content Supplier Registry v1
-- Apply once to the same Supabase project used by media_candidates.
create table if not exists public.media_content_suppliers (
  id text primary key,
  name text not null,
  website_url text not null,
  website_host text not null,
  supplier_type text not null default 'other' check (supplier_type in ('production','distributor','studio','rights_holder','agency','archive','other')),
  status text not null default 'candidate' check (status in ('candidate','active','paused','archived')),
  country text,
  contact_url text,
  search_terms jsonb not null default '[]'::jsonb,
  notes text,
  source_mode text not null default 'manual',
  raw jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);
create unique index if not exists media_content_suppliers_host_name_idx on public.media_content_suppliers (website_host, lower(name));
create index if not exists media_content_suppliers_status_idx on public.media_content_suppliers (status, updated_at desc);
create index if not exists media_content_suppliers_type_idx on public.media_content_suppliers (supplier_type, updated_at desc);
alter table public.media_content_suppliers enable row level security;
-- No browser/client policy is created. Access is server-side through the existing service-role protected admin function only.
