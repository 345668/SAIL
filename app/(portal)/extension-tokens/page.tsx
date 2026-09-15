import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"
import { ExtensionTokensClient, type TokenSummary } from "./extension-tokens-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Extension tokens — Anker Portal" }

function toIso(v: any): string | null {
  if (!v) return null
  try {
    return typeof v === "string" ? new Date(v).toISOString() : v.toISOString()
  } catch { return null }
}

function map(rows: any[]): TokenSummary[] {
  return rows.map((r) => ({
    id: String(r.id),
    userId: String(r.user_id ?? ""),
    prefix: String(r.prefix ?? "").slice(0, 12),
    label: r.label ? String(r.label) : null,
    createdAt: toIso(r.created_at),
    lastUsedAt: toIso(r.last_used_at),
    revokedAt: toIso(r.revoked_at),
  }))
}

/**
 * Lists every user's tokens, unlike Anker's page which scopes to the signed-in
 * user. The COALESCE + fallback mirrors Anker's handling of schema drift: the
 * v0 schema populated `prefix`, an earlier bootstrap migration `token_prefix`.
 */
async function loadTokens(): Promise<{ tokens: TokenSummary[]; error: string | null }> {
  try {
    const rows: any[] = await sql`
      SELECT id, user_id,
             COALESCE(prefix, token_prefix) AS prefix,
             label, created_at, last_used_at, revoked_at
        FROM extension_tokens
       ORDER BY created_at DESC
       LIMIT 500`
    return { tokens: map(rows), error: null }
  } catch {
    try {
      const rows: any[] = await sql`
        SELECT id, user_id, prefix, label, created_at, last_used_at, revoked_at
          FROM extension_tokens
         ORDER BY created_at DESC
         LIMIT 500`
      return { tokens: map(rows), error: null }
    } catch (e: any) {
      return { tokens: [], error: e?.message || "load failed" }
    }
  }
}

export default async function ExtensionTokensPage() {
  const { tokens, error } = await loadTokens()
  const tenantUrl = process.env.TENANT_APP_URL || "https://www.an-ker.de"

  return (
    <PageShell
      eyebrow="Platform · Extension"
      title="LinkedIn extension tokens"
      description="Bearer tokens for the Anker LinkedIn Chrome extension, across every tenant user. Only the SHA-256 hash is stored — plaintext is shown once at mint. Revoking takes effect on the extension's next request."
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn&apos;t load tokens: <span className="text-[var(--danger)]">{error}</span>
        </div>
      ) : (
        <ExtensionTokensClient initialTokens={tokens} tenantUrl={tenantUrl} />
      )}
    </PageShell>
  )
}
