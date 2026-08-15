import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"
import { PlatformKeysClient, type KeyRow } from "./platform-keys-client"

export const dynamic = "force-dynamic"

async function loadKeys(): Promise<{ keys: KeyRow[]; error: string | null }> {
  try {
    const rows = await sql`
      SELECT id, provider, label, last4, scope, disabled, created_at, rotated_at
      FROM platform_api_keys ORDER BY provider, created_at DESC`
    return { keys: rows as any[], error: null }
  } catch (e: any) {
    return { keys: [], error: e?.message || "load failed" }
  }
}

export default async function PlatformKeysPage() {
  const { keys, error } = await loadKeys()
  return (
    <PageShell
      eyebrow="Platform"
      title="Platform API keys"
      description="The platform’s own provider keys — the AI router, email, enrichment. Distinct from each user’s personal keys on the tenant app. Secrets are AES-256-GCM encrypted at rest and never displayed after entry."
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn’t load keys: <span className="text-[var(--danger)]">{error}</span>
          <div className="mt-1">Run the <code>2026-08-15-company-portal.sql</code> migration first.</div>
        </div>
      ) : (
        <PlatformKeysClient initial={keys} />
      )}
    </PageShell>
  )
}
