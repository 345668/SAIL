import { PageShell } from "@/components/page-shell"
import { proxyConfig } from "@/lib/anker-proxy"
import { ResearchClient } from "./research-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Deep research — Anker Portal" }

export default function ResearchPage() {
  // The crawl + synthesis engine lives in the tenant app; this page is the UI.
  // Say so up front when the relay isn't wired, rather than letting the first
  // run fail with a 503.
  const configured = !!proxyConfig()

  return (
    <PageShell
      eyebrow="Data & growth · research"
      title="Crawl, synthesize, dossier."
      description="Multi-page crawl of a firm site plus AI synthesis into a Markdown dossier, with citations to each source page and a Word download. The engine runs in the tenant app; this is the console."
    >
      {!configured && (
        <div className="mb-4 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-4 text-sm">
          <div className="font-semibold text-[var(--danger)]">Relay not configured</div>
          <p className="mt-1 text-muted-foreground">
            Set <code className="font-mono">ANKER_BASE_URL</code> (or{" "}
            <code className="font-mono">TENANT_APP_URL</code>) and a{" "}
            <code className="font-mono">PORTAL_SERVICE_TOKEN</code> of at least 32 characters,
            matching the value set in the tenant app. Until then research requests will
            return 503.
          </p>
        </div>
      )}
      <ResearchClient />
    </PageShell>
  )
}
