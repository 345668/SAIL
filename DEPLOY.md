# Deploying SAIL (Anker Company Portal)

Production is **Vercel**, deployed automatically on every push to `main` by
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## One-time setup

1. **Link the repo to a Vercel project** (locally, once):
   ```bash
   npm i -g vercel
   vercel link          # pick your team + create/select the SAIL project
   ```
   This writes `.vercel/project.json` (gitignored). Note its `orgId` and
   `projectId`.

2. **Add the three Actions secrets** in GitHub → *Settings → Secrets and
   variables → Actions*:

   | Secret | Value |
   |---|---|
   | `VERCEL_TOKEN` | a token from <https://vercel.com/account/tokens> |
   | `VERCEL_ORG_ID` | `orgId` from `.vercel/project.json` |
   | `VERCEL_PROJECT_ID` | `projectId` from `.vercel/project.json` |

3. **Set the runtime env vars** in the Vercel project → *Settings →
   Environment Variables → Production* (these are pulled at build time, not
   stored in the repo):

   | Var | Purpose |
   |---|---|
   | `NEON_DATABASE_URL` | the shared platform Neon DB |
   | `SECRET_KEY` | session HMAC + API-key encryption (same secret family as the tenant app) |
   | `TENANT_APP_URL` | tenant Venture OS origin, for the impersonation hand-off link |

4. **Apply the schema once** against the production DB:
   ```bash
   NEON_DATABASE_URL=... npm run migrate
   NEON_DATABASE_URL=... STAFF_PASSWORD='…' npm run seed:staff -- \
     --email you@an-ker.de --name "You" --role superadmin
   ```

## After that

Every `git push origin main` triggers the workflow, which runs
`vercel pull → vercel build --prod → vercel deploy --prebuilt --prod`. You can
also run it manually from the **Actions** tab (workflow_dispatch), or deploy
from your machine with `vercel --prod`.

The `if:` guard in the workflow scopes runs to `345668/SAIL`, so forks don't
fail red without secrets. If you rename or move the repo, update that line.

## Package manager and previews

npm only: `package-lock.json` is the one lockfile, `packageManager` is pinned in `package.json`, and CI fails if a yarn, pnpm or bun lockfile appears.

There is deliberately **no preview deployment** of pull requests. SAIL is the staff console and shares the production database; a preview would either hold production credentials on a public URL or fail without them. A preview environment needs its own database branch and its own Preview-scoped variables first (Neon branch, `SECRET_KEY`, `TENANT_APP_URL`), and a staff-only access rule. Until then the typecheck-and-test gate on every pull request is the safety net.
