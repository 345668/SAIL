import { PageShell } from "@/components/page-shell"
import { proxyConfig } from "@/lib/anker-proxy"
import { WaitlistClient } from "./waitlist-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Early access — Anker Portal" }

export default function Page() {
  // The queue and the tokens live in the tenant app; this page is the console.
  // Say so up front when the relay is unwired, rather than letting the first
  // action 503.
  const configured = !!proxyConfig()
  return (
    <PageShell
      eyebrow="Governance · access"
      title="Early access"
      description="Review access requests from the public site and invite applicants. An invitation is a single-use link, bound to that applicant's own address — it cannot be forwarded, and it can be revoked until it is used."
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
      <WaitlistClient />
    </PageShell>
  )
}
