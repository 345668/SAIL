import { PageShell } from "@/components/page-shell"
import { proxyConfig } from "@/lib/anker-proxy"
import { AgentFrame } from "./agent-frame"

export const dynamic = "force-dynamic"
export const metadata = { title: "Outreach agents — Anker Portal" }

export default function Page() {
  const configured = !!proxyConfig()
  return (
    <PageShell
      eyebrow="Data & growth · agents"
      title="Outreach agents"
      description="Run the profile and outreach agents and inspect recent runs. Agent execution runs as the selected tenant user in the tenant app."
    >
      {!configured && (
        <div className="mb-4 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-4 text-sm">
          <div className="font-semibold text-[var(--danger)]">Relay not configured</div>
          <p className="mt-1 text-muted-foreground">
            Set <code className="font-mono">ANKER_BASE_URL</code> and a{" "}
            <code className="font-mono">PORTAL_SERVICE_TOKEN</code> of at least 32 characters,
            matching the tenant app. Until then requests return 503.
          </p>
        </div>
      )}
      <AgentFrame />
    </PageShell>
  )
}
