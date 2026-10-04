-- Proof that an erasure happened, holding no customer content (docs/architecture/41 §6). Additive.
CREATE TABLE IF NOT EXISTS tenant_tombstones (
  id            bigserial PRIMARY KEY,
  org_id        text NOT NULL,
  org_name_hash text,
  request_id    text NOT NULL UNIQUE,
  requested_by  text,
  status        text NOT NULL DEFAULT 'started' CHECK (status IN ('started','done','failed')),
  counts        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  executed_at   timestamptz
);
CREATE INDEX IF NOT EXISTS tenant_tombstones_org_idx ON tenant_tombstones (org_id);
