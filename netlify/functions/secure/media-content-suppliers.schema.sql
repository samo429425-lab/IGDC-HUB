-- IGDC Media Hub content supplier registry
-- Apply once in the Media Hub Supabase project before using supplier research.
create table if not exists public.media_content_suppliers (
  id text primary key,
  name text not null,
  supplier_type text not null default 'other' check (supplier_type in ('production','distributor','studio','rights_holder','agency','archive','other')),
  country text,
  website_url text,
  website_host text,
  search_terms jsonb not null default '[]'::jsonb,
  notes text,
  status text not null default 'candidate' check (status in ('candidate','active','paused','archived')),
  source text not null default 'manual',
  research jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);
create index if not exists media_content_suppliers_status_idx on public.media_content_suppliers(status);
create index if not exists media_content_suppliers_type_idx on public.media_content_suppliers(supplier_type);
create index if not exists media_content_suppliers_country_idx on public.media_content_suppliers(country);
create unique index if not exists media_content_suppliers_host_uq on public.media_content_suppliers(website_host) where website_host is not null and website_host <> '';

alter table public.media_content_suppliers enable row level security;
-- Browser clients receive no direct table policy. The Netlify function uses the
-- server-side service role after validated administrator authentication.
