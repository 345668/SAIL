-- Staff security: server-side sessions (revocable, checked on every request), TOTP two-factor, and a login-attempt
-- record for lockout and audit. Additive and idempotent. See docs/architecture/38 §3.9 in the Anker repository.

CREATE TABLE IF NOT EXISTS staff_sessions (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  staff_id     text NOT NULL REFERENCES company_staff(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  -- A session is created by the password and only becomes usable once the second factor is verified.
  mfa_verified boolean NOT NULL DEFAULT false,
  ip           text,
  user_agent   text
);
CREATE INDEX IF NOT EXISTS staff_sessions_staff_idx ON staff_sessions (staff_id, created_at DESC);

CREATE TABLE IF NOT EXISTS staff_mfa (
  staff_id       text PRIMARY KEY REFERENCES company_staff(id) ON DELETE CASCADE,
  secret_enc     text NOT NULL,                 -- AES-GCM via lib/crypto.ts, never stored in the clear
  enabled_at     timestamptz,                   -- NULL while enrolment is started but not confirmed
  backup_hashes  text[] NOT NULL DEFAULT '{}',  -- sha256 of one-time recovery codes
  last_used_step bigint                         -- the last accepted time step, so a code cannot be replayed
);

CREATE TABLE IF NOT EXISTS staff_login_attempts (
  id     bigserial PRIMARY KEY,
  email  text NOT NULL,
  ip     text,
  ok     boolean NOT NULL,
  kind   text NOT NULL DEFAULT 'password',      -- password | mfa
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_login_attempts_email_idx ON staff_login_attempts (lower(email), at DESC);
CREATE INDEX IF NOT EXISTS staff_login_attempts_ip_idx ON staff_login_attempts (ip, at DESC);
