import { PageShell } from "@/components/page-shell"
import { RefreshButton } from "@/components/refresh-button"
import { dbCheck, serviceChecks, tableCounts, type Check } from "@/lib/health"

export const dynamic = "force-dynamic"

const DOT: Record<Check["status"], string> = {
  ok: "var(--ok)",
  down: "var(--danger)",
  unconfigured: "var(--muted-foreground)",
}
const STATUS_LABEL: Record<Check["status"], string> = {
  ok: "Reachable",
  down: "Down",
  unconfigured: "Not configured",
}

export default async function SystemPage() {
  const [db, services, counts] = await Promise.all([dbCheck(), serviceChecks(), tableCounts()])
  const checks = [db, ...services]

  return (
    <PageShell
      eyebrow="Platform"
      title="System health"
      description="Live reachability of the shared platform infrastructure and shared-DB table counts. Service pings honor OLLAMA_URL / SEARXNG_URL / MARKER_URL / TENANT_APP_URL."
      action={<RefreshButton />}
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {checks.map((c) => (
          <div key={c.name} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: DOT[c.status] }} />
              <div className="font-medium text-sm">{c.name}</div>
              {c.ms != null && <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{c.ms} ms</span>}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              <span style={{ color: DOT[c.status] }}>{STATUS_LABEL[c.status]}</span> · {c.detail}
            </div>
            {c.target && <div className="mt-1 font-mono text-[10px] text-muted-foreground break-all">{c.target}</div>}
          </div>
        ))}
      </div>

      <h2 className="font-display text-lg mt-8 mb-3">Shared-DB tables</h2>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5">Table</th>
              <th className="text-right px-4 py-2.5">Rows</th>
              <th className="text-left px-4 py-2.5">State</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((t) => (
              <tr key={t.table} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs">{t.table}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.count == null ? "—" : t.count.toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  {t.count == null
                    ? <span className="text-[var(--danger)] text-xs">missing / unreadable</span>
                    : <span style={{ color: "var(--ok)" }} className="text-xs">ok</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
