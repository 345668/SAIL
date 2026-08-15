# Anker Company Administration Portal

A **separate app with its own auth**, firewalled from the tenant Venture OS. It
administers platform-wide state (the global investor DB, AI router + platform API
keys, platform email identity, the public newsroom, all-user admin) that a scope
audit confirmed does **not** belong on any tenant workspace. See
[`docs/platform-audit-addendum.md`](../docs/platform-audit-addendum.md).

Runs on **port 3100** (tenant app is 3000).

## Why separate
- **Own identity store** — `company_staff` table, scrypt passwords, HMAC sessions. No tenant Supabase auth.
- **Shared platform DB** — reads/writes the same Neon DB to actually administer the platform.
- **View-as impersonation** — staff open the tenant app "as" an org via a single-use, 5-minute, audited grant (tenant-side acceptance is phase 2).

## Setup
1. Apply the migration (from the repo root, against the platform Neon DB):
   ```bash
   NEON_DATABASE_URL="$(grep -E '^NEON_DATABASE_URL=' ../.env.local | cut -d= -f2-)" \
     node ../scripts/oneshot/run-migration.mjs scripts/migrations/2026-08-15-company-portal.sql
   ```
2. `cp .env.local.example .env.local` and fill `NEON_DATABASE_URL`, `SECRET_KEY`, `TENANT_APP_URL`.
3. Install + seed the first staff account (you supply the password):
   ```bash
   npm install
   NEON_DATABASE_URL=... STAFF_PASSWORD='your-strong-pass' \
     npm run seed:staff -- --email you@an-ker.de --name "You" --role superadmin
   ```
4. `npm run dev` → http://localhost:3100 → sign in.

## Status
**Built:** auth + login, portal shell, Dashboard (platform stats), Organizations
(with view-as mint), **Platform API keys** (AES-256-GCM at rest), Users, Audit log.

**Phase 2 (migrating from the tenant Owner Console):** Data ops (import/crawl/
enrich/url-check/email-check), Send Center (outbox/replies/agent), Newsroom CMS,
AI config, System health, Billing — plus tenant-side `/api/impersonate/accept`.
Once these land here, the platform-ops tools come **off** the tenant app entirely.
