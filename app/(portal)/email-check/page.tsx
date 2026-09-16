import { PageShell } from "@/components/page-shell"
import { proxyConfig } from "@/lib/anker-proxy"
import { EmailCheckClient } from "./email-check-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Email verification — Anker Portal" }

export default function Page() {
  // The engine lives in the tenant app; this page is the console. Say so up
  // front when the relay is unwired, rather than letting the first action 503.
  const configured = !!proxyConfig()
  return (
    <PageShell
      eyebrow="Data & growth · quality"
      title="Email verification"
      description="Verify deliverability of stored contact addresses and repair or replace the ones that fail."
    >
      {!configured && (
        <div className="mb-4 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-4 text-sm">
          <div className="font-semibold text-[var(--danger)]">Relay not configured</div>
          <p className="mt-1 text-muted-foreground">
            Set <code className="font-mono">ANKER_BASE_URL</code> (or{" "}
            <code className="font-mono">TENANT_APP_URL</code>) and a{" "}
            <code className="font-mono">PORTAL_SERVICE_TOKEN</code> of at least 32 characters,
            matching the tenant app. Until then requests return 503.
          </p>
        </div>
      )}
      <EmailCheckClient />
    </PageShell>
  )
}
