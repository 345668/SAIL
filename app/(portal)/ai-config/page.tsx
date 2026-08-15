import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"
import { EMPTY_AI_CONFIG, type AiRouterConfig } from "@/lib/ai-tasks"
import { AiConfigClient } from "./ai-config-client"

export const dynamic = "force-dynamic"

async function loadConfig(): Promise<{ config: AiRouterConfig; error: string | null }> {
  try {
    const rows = await sql`SELECT value FROM system_settings WHERE key = 'ai_router_v1' LIMIT 1`
    const v = (rows[0] as any)?.value
    const config: AiRouterConfig =
      v && typeof v === "object"
        ? { ...EMPTY_AI_CONFIG, ...v, enabled: { ...(v.enabled ?? {}) }, modelOverride: { ...(v.modelOverride ?? {}) } }
        : { ...EMPTY_AI_CONFIG }
    return { config, error: null }
  } catch (e: any) {
    return { config: { ...EMPTY_AI_CONFIG }, error: e?.message || "load failed" }
  }
}

export default async function AiConfigPage() {
  const { config, error } = await loadConfig()
  return (
    <PageShell
      eyebrow="Platform"
      title="AI config"
      description="The global AI router — force a provider, override the model per task, or switch a task off. Writes the same shared-DB knob (system_settings/ai_router_v1) the tenant router reads, so changes take effect platform-wide."
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn’t load the router config: <span className="text-[var(--danger)]">{error}</span>. Confirm{" "}
          <code>system_settings</code> exists in the shared DB (portal migration seeds it).
        </div>
      ) : (
        <AiConfigClient initial={config} />
      )}
    </PageShell>
  )
}
