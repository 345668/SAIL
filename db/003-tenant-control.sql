-- Tenant lifecycle, entitlements and flags. Same statements as the tenant app's 2026-10-04c migration (shared tables, idempotent), so SAIL can bring them up on its own. Additive.

-- The plan catalogue, editable in SAIL. Numbers are placeholders until pricing is validated; a workspace with no plan is unrestricted.
CREATE TABLE IF NOT EXISTS plan_catalog (
  plan       text PRIMARY KEY,
  label      text NOT NULL,
  features   jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits     jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort       integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plan_catalog (plan, label, features, limits, sort) VALUES
 ('starter',  'Starter',  '{"assistant":true,"outreach":true,"linkedin":false,"matchmaking":true,"intake":false,"tools":true,"fund_ops":false,"spvs":false}'::jsonb,
                           '{"ai_spend_usd_month":10,"seats":2,"outreach_sends_day":50,"intake_submissions_month":0,"storage_mb":1000}'::jsonb, 1),
 ('pro',      'Pro',      '{"assistant":true,"outreach":true,"linkedin":true,"matchmaking":true,"intake":true,"tools":true,"fund_ops":true,"spvs":false}'::jsonb,
                           '{"ai_spend_usd_month":100,"seats":10,"outreach_sends_day":300,"intake_submissions_month":200,"storage_mb":10000}'::jsonb, 2),
 ('scale',    'Scale',    '{"assistant":true,"outreach":true,"linkedin":true,"matchmaking":true,"intake":true,"tools":true,"fund_ops":true,"spvs":true}'::jsonb,
                           '{"ai_spend_usd_month":500,"seats":50,"outreach_sends_day":1000,"intake_submissions_month":2000,"storage_mb":100000}'::jsonb, 3),
 ('internal', 'Internal', '{"assistant":true,"outreach":true,"linkedin":true,"matchmaking":true,"intake":true,"tools":true,"fund_ops":true,"spvs":true}'::jsonb,
                           '{}'::jsonb, 9)
ON CONFLICT (plan) DO NOTHING;

-- Per-workspace plan and overrides. No row = open (everything allowed, no limits).
CREATE TABLE IF NOT EXISTS tenant_entitlements (
  org_id     text PRIMARY KEY,
  plan       text,
  features   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- overrides: key -> true|false
  limits     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- overrides: key -> number, or null for unlimited
  notes      text,
  version    integer NOT NULL DEFAULT 1,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Lifecycle. No row = active.
CREATE TABLE IF NOT EXISTS tenant_lifecycle (
  org_id        text PRIMARY KEY,
  state         text NOT NULL CHECK (state IN ('trial','active','paused','offboarding')),
  reason        text,
  trial_ends_at timestamptz,
  changed_by    text,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_lifecycle_events (
  id         bigserial PRIMARY KEY,
  org_id     text NOT NULL,
  from_state text,
  to_state   text NOT NULL,
  reason     text,
  actor      text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_lifecycle_events_org_idx ON tenant_lifecycle_events (org_id, id DESC);

-- Platform flags and maintenance mode. rollout_pct is decided per workspace by a stable hash.
CREATE TABLE IF NOT EXISTS platform_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  rollout_pct integer NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  description text,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform_flags (key, enabled, rollout_pct, description) VALUES
 ('maintenance', false, 100, 'Maintenance mode: shows a banner and refuses AI runs and outreach sends for everyone')
ON CONFLICT (key) DO NOTHING;

-- Export and erasure requests (phase B), created now so the queue and its deadline clock have a home.
CREATE TABLE IF NOT EXISTS tenant_requests (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id       text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('export','erasure')),
  status       text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','dry_run','approved','running','done','failed','cancelled','rejected')),
  requested_by text,
  approved_by  text,
  deadline_at  timestamptz,
  execute_after timestamptz,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_requests_org_idx ON tenant_requests (org_id, created_at DESC);
