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
