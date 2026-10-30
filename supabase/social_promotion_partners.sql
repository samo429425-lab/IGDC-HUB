-- Run once in Supabase SQL editor BEFORE using Social Partner Registry.
-- IGDC Social dedicated promotion agreements; not a public content seed.
CREATE TABLE IF NOT EXISTS public.social_promotion_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 180),
  partner_kind TEXT NOT NULL CHECK (partner_kind IN ('influencer','business')),
  section_key TEXT NOT NULL CHECK (section_key IN ('social-youtube','social-instagram','social-tiktok','social-facebook','social-reddit')),
  channel_url TEXT NOT NULL,
  website_url TEXT NOT NULL DEFAULT '',
  promotion_target_url TEXT NOT NULL DEFAULT '',
  target_kind TEXT NOT NULL DEFAULT 'distribution' CHECK (target_kind IN ('distribution','media','platform')),
  cooperation_status TEXT NOT NULL DEFAULT 'prospect' CHECK (cooperation_status IN ('prospect','negotiating','active','paused')),
  priority_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  contract_proof_reference TEXT NOT NULL DEFAULT '',
  signed_from DATE,
  signed_until DATE,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT social_promotion_partner_contract_dates CHECK (signed_until IS NULL OR signed_from IS NULL OR signed_until >= signed_from),
  CONSTRAINT social_promotion_verified_activation CHECK (
    cooperation_status <> 'active' OR
    (priority_enabled = TRUE AND verified_at IS NOT NULL AND verified_by IS NOT NULL AND
      nullif(btrim(contract_proof_reference), '') IS NOT NULL AND signed_from IS NOT NULL)),
  UNIQUE (section_key, channel_url)
);
CREATE INDEX IF NOT EXISTS social_promotion_active_priority_idx
  ON public.social_promotion_partners (section_key, cooperation_status, priority_enabled);
-- Browser clients have NO direct table access. Only authenticated Netlify function + service-role key.
ALTER TABLE public.social_promotion_partners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.social_promotion_partners FROM anon, authenticated;
