import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"
import { EMPTY_AI_CONFIG, type AiRouterConfig } from "@/lib/ai-tasks"
import { AiConfigClient } from "./ai-config-client"
import { hasEncryptionKey, isEncrypted } from "@/lib/config-crypto"
import { AiUsagePanel } from "./ai-usage-panel"

export const dynamic = "force-dynamic"

const SECRET_FIELDS = ["anthropicApiKey", "openaiApiKey", "geminiApiKey", "mistralApiKey", "qwenApiKey"] as const
export interface KeyStatus { name: string; set: boolean; last4: string | null; encrypted: boolean }

async function loadConfig(): Promise<{ config: AiRouterConfig; keys: KeyStatus[]; error: string | null }> {
  try {
    const rows = await sql`SELECT value FROM system_settings WHERE key = 'ai_router_v1' LIMIT 1`
    const v = (rows[0] as any)?.value
    const config: AiRouterConfig =
      v && typeof v === "object"
        ? { ...EMPTY_AI_CONFIG, ...v, enabled: { ...(v.enabled ?? {}) }, modelOverride: { ...(v.modelOverride ?? {}) } }
        : { ...EMPTY_AI_CONFIG }
    // The secrets are stripped before they reach the client component. This
    // page previously handed the whole config, API keys included, to the
    // browser as serialized props.
    const store = config as Record<string, unknown>
    const keys: KeyStatus[] = SECRET_FIELDS.map((name) => {
      const raw = typeof store[name] === "string" ? (store[name] as string) : ""
      if (!raw) return { name, set: false, last4: null, encrypted: false }
      return { name, set: true, last4: isEncrypted(raw) ? null : raw.slice(-4), encrypted: isEncrypted(raw) }
    })
    for (const name of SECRET_FIELDS) delete store[name]
    return { config, keys, error: null }
  } catch (e: any) {
    return { config: { ...EMPTY_AI_CONFIG }, keys: [], error: e?.message || "load failed" }
  }
}

export default async function AiConfigPage() {
  const { config, keys, error } = await loadConfig()
  return (
    <PageShell
      eyebrow="Platform"
      title="AI config"
      description="The global AI router — force a provider, override the model per task, or switch a task off, then see what the router actually did. Writes the same shared-DB knob (system_settings/ai_router_v1) the tenant router reads, so changes take effect platform-wide."
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn’t load the router config: <span className="text-[var(--danger)]">{error}</span>. Confirm{" "}
          <code>system_settings</code> exists in the shared DB (portal migration seeds it).
        </div>
      ) : (
        <AiConfigClient initial={config} keys={keys} canEncrypt={hasEncryptionKey()} />
      )}
      {/* The other half of the job. Setting a key and flipping a switch are
          only useful if you can see what happened next. */}
      <AiUsagePanel />
    </PageShell>
  )
}
