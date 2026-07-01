-- IGDC MARU Media Access storage contract — stages 7–10.
-- Apply only to the private server-side database selected for Netlify env vars.
-- Do not put provider keys, card data, raw member IDs, or signed stream URLs here.

create table if not exists media_access_entitlements (
  id text primary key,
  member_hash text not null,
  product_id text not null,
  scope_type text not null check (scope_type in ('content','series','catalog')),
  scope_id text not null,
  status text not null check (status in ('active','expired','revoked','refunded','cancelled','pending')),
  valid_from timestamptz not null,
  valid_until timestamptz null,
  source text null,
  order_id text null,
  updated_at timestamptz not null default now()
);
create index if not exists media_access_entitlements_member_idx on media_access_entitlements (member_hash, updated_at desc);
create index if not exists media_access_entitlements_scope_idx on media_access_entitlements (scope_type, scope_id, status);

create table if not exists media_access_orders (
  id text primary key,
  member_hash text not null,
  product_id text not null,
  currency text not null check (currency in ('USD','CNY','EUR')),
  amount_minor bigint not null check (amount_minor >= 0),
  status text not null check (status in ('payment_not_started','payment_pending','paid','failed','cancelled','refunded','expired')),
  provider text null,
  provider_reference text null,
  idempotency_key text not null,
  access_scope_type text not null,
  access_scope_id text not null,
  terms_version text null,
  expires_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_hash, idempotency_key)
);
create index if not exists media_access_orders_member_idx on media_access_orders (member_hash, updated_at desc);

create table if not exists media_access_events (
  id text primary key,
  member_hash text null,
  order_id text null,
  entitlement_id text null,
  event_type text not null,
  source text not null,
  detail_code text null,
  created_at timestamptz not null default now()
);
create index if not exists media_access_events_order_idx on media_access_events (order_id, created_at desc);
