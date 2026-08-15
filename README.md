# Anker Company Administration Portal

A **separate app with its own auth**, firewalled from the tenant Anker Venture OS.
It administers platform-wide state (the global investor DB, AI router + platform
API keys, platform email identity, the public newsroom, all-user admin) that a
scope audit confirmed does **not** belong on any tenant workspace.

Runs on **port 3100** (tenant app is 3000). Shares the tenant app's Neon database.

## Why separate
- **Own identity store** — `company_staff` table, scrypt passwords, HMAC sessions. No tenant Supabase auth.
- **Shared platform DB** — reads/writes the same Neon DB to actually administer the platform.
- **View-as impersonation** — staff open the tenant app "as" an org via a single-use, 5-minute, audited grant (tenant-side acceptance is phase 2).

## Setup
1. `npm install`
2. `cp .env.local.example .env.local` and fill `NEON_DATABASE_URL` (the platform
   Neon DB), `SECRET_KEY`, and `TENANT_APP_URL`.
3. Apply the schema:
   ```bash
   NEON_DATABASE_URL=... npm run migrate
   ```
4. Seed the first staff account (you supply the password — it's never stored raw):
   ```bash
   NEON_DATABASE_URL=... STAFF_PASSWORD='your-strong-pass' \
     npm run seed:staff -- --email you@an-ker.de --name "You" --role superadmin
   ```
5. `npm run dev` → http://localhost:3100 → sign in.

## Status
**Built:** auth + login, portal shell, Dashboard (platform stats), Organizations
(with view-as mint), **Platform API keys** (AES-256-GCM at rest), Users, Audit log.

**AI config** — edits the shared-DB router knob (`system_settings/ai_router_v1`):
force a provider (with optional strict/no-failover), per-task model overrides, and
per-task on/off. The tenant router reads the same row, so changes are platform-wide.

**Newsroom CMS** — full draft → publish → archive over `news_articles`, with
slugging and audited transitions. Drafts stay private until published.

**System health** — live reachability of Postgres + Ollama/SearXNG/Marker/tenant
(pings honor the service env vars) and shared-DB table counts.

**Data ops** — read model over the global investor DB: coverage (email/LinkedIn),
enrichment state, and a records-by-source breakdown.

**Send Center** — outbox-by-status and replies-by-classification rollups over
`outreach_messages` / `outreach_replies`.

**Billing & credits** — platform inventory (orgs, keys, seats, storage driver) and
30-day AI spend by provider from `platform_usage_events`.

Every panel degrades gracefully if a shared table is absent, and every write is
recorded in `company_audit_log`.

**Still phase 2:** tenant-side `/api/impersonate/accept` (the portal already mints
and audits grants), plus write-side job triggers for Data ops and Send Center as
they migrate off the tenant Owner Console. Once those land, all platform-ops
tooling is **off** the tenant app.
