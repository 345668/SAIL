-- Company Administration Portal — separate auth realm + platform-level tables.
-- Shares the platform Neon DB (to administer it) but its OWN identity store,
-- firewalled from tenant Supabase auth. Seed the first staff account with
-- scripts/oneshot/seed-company-staff.mjs (never hard-code a password here).

-- ── Company staff (portal identity store) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS company_staff (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email         text NOT NULL UNIQUE,
  name          text,
  -- scrypt hash "scrypt$<saltB64>$<hashB64>" — verified in company-portal/lib/auth.
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'staff' CHECK (role IN ('staff','admin','superadmin')),
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

-- ── Platform API keys (the platform's OWN keys — not per-user) ───────────────
-- Distinct from /dashboard/settings/api-keys, which holds each user's own keys.
CREATE TABLE IF NOT EXISTS platform_api_keys (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  provider     text NOT NULL,               -- anthropic | gemini | openai | resend | hunter | …
  label        text,                        -- human note, e.g. "prod router key"
  -- AES-256-GCM ciphertext of the secret, keyed by SECRET_KEY. Never returned raw.
  secret_cipher text NOT NULL,
  last4        text,                         -- shown in the UI for identification
  scope        text NOT NULL DEFAULT 'platform',
  disabled     boolean NOT NULL DEFAULT false,
  created_by   text REFERENCES company_staff(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  rotated_at   timestamptz
);
CREATE INDEX IF NOT EXISTS platform_api_keys_provider_idx ON platform_api_keys (provider, created_at DESC);

-- ── Impersonation grants (portal → tenant "view as") ────────────────────────
-- The portal mints a single-use short-lived grant. The tenant app accepts the
-- token, scopes a read-only or full session to that org, and shows a banner.
CREATE TABLE IF NOT EXISTS impersonation_grants (
  id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  staff_id    text NOT NULL REFERENCES company_staff(id),
  staff_email text,
  org_id      text NOT NULL,
  mode        text NOT NULL DEFAULT 'readonly' CHECK (mode IN ('readonly','full')),
  token_hash  text NOT NULL,                 -- sha256 of the opaque token (raw token never stored)
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS impersonation_grants_token_idx ON impersonation_grants (token_hash);

-- ── System settings (shared KV — the AI-router knob lives here) ─────────────
-- The tenant app owns this table; we CREATE IF NOT EXISTS so a standalone
-- portal DB still works, and seed the router key so /ai-config has a row to
-- edit. On the shared DB this is a no-op (the tenant already created it).
CREATE TABLE IF NOT EXISTS system_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO system_settings (key, value, description)
  VALUES (
    'ai_router_v1',
    '{"enabled": {}, "modelOverride": {}, "providerOverride": null}'::jsonb,
    'Per-task AI router config — edited by the company portal /ai-config, read by the tenant router.'
  )
  ON CONFLICT (key) DO NOTHING;

-- ── Platform usage events (cost metering for Billing) ───────────────────────
-- Portal-owned. The AI router (or any metered service) appends one row per
-- billable call; the Billing page rolls these up by provider over 30 days.
CREATE TABLE IF NOT EXISTS platform_usage_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider    text NOT NULL,                 -- anthropic | gemini | openai | resend | …
  task        text,                          -- router task tag, when applicable
  org_id      text,                          -- attributing tenant, when known
  tokens_in   integer,
  tokens_out  integer,
  cost_usd    numeric(12,6) NOT NULL DEFAULT 0,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_usage_events_provider_time_idx
  ON platform_usage_events (provider, occurred_at DESC);

-- ── Audit log (platform-wide, written by the portal) ────────────────────────
CREATE TABLE IF NOT EXISTS company_audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id   text,
  staff_email text,
  action     text NOT NULL,                  -- e.g. impersonate.start, api_key.rotate
  target     text,                           -- org id, key id, etc.
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_audit_log_created_idx ON company_audit_log (created_at DESC);

-- ── Newsroom CMS (shared with the tenant public /newsroom) ──────────────────
-- The tenant app owns news_articles; we CREATE IF NOT EXISTS so a standalone
-- portal DB still works, and add the CMS columns the editor needs (idempotent
-- on the shared DB where they already exist).
CREATE TABLE IF NOT EXISTS news_articles (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  headline      text NOT NULL,
  subheadline   text,
  content       text,
  author        text NOT NULL DEFAULT 'Anker',
  blog_type     text NOT NULL DEFAULT 'Insights',
  tags          jsonb DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'draft',
  image_url     text,
  published_at  timestamptz,
  created_by    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE news_articles
  ADD COLUMN IF NOT EXISTS slug           text,
  ADD COLUMN IF NOT EXISTS scheduled_for  timestamptz,
  ADD COLUMN IF NOT EXISTS source_pdf_url text,
  ADD COLUMN IF NOT EXISTS sentiment      text;  -- 'bullish' | 'neutral' | 'bearish'
CREATE UNIQUE INDEX IF NOT EXISTS news_articles_slug_unique_idx ON news_articles (slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS news_articles_status_pub_idx ON news_articles (status, published_at DESC);

-- ── Newsroom themes (editorial lenses that steer AI drafting) ───────────────
CREATE TABLE IF NOT EXISTS news_themes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  description text,
  keywords    text[] NOT NULL DEFAULT '{}',
  enabled     boolean NOT NULL DEFAULT true,
  position    int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO news_themes (name, slug, description, keywords, position) VALUES
  ('Venture Capital', 'venture-capital', 'Fund launches, LP commitments, emerging managers', ARRAY['venture capital','vc fund','emerging manager','fund launch','LP commitment'], 1),
  ('Family Offices', 'family-offices', 'Family office allocations and direct investing', ARRAY['family office','single family office','wealth management','direct investment'], 2),
  ('Climate & Energy', 'climate-energy', 'Climate tech, energy transition, green capital', ARRAY['climate tech','energy transition','decarbonization','green hydrogen','cleantech'], 3),
  ('AI Infrastructure', 'ai-infrastructure', 'AI compute, models, and the capital behind them', ARRAY['artificial intelligence','ai infrastructure','data center','gpu','foundation model'], 4),
  ('Secondaries & Liquidity', 'secondaries', 'Secondary sales, continuation funds, GP-led deals', ARRAY['secondaries','continuation fund','gp-led','tender offer','liquidity'], 5)
ON CONFLICT (slug) DO NOTHING;
