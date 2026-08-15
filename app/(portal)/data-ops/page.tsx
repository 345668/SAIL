import { sql } from "@/lib/db"
import { PageShell, StatTile } from "@/components/page-shell"
import { RefreshButton } from "@/components/refresh-button"

export const dynamic = "force-dynamic"

async function n(q: Promise<any[]>): Promise<number | null> {
  try {
    return Number(((await q)[0] as any)?.n ?? 0)
  } catch {
    return null
  }
}

async function bySource(): Promise<{ source: string; n: number }[]> {
  try {
    const rows = await sql`
      SELECT COALESCE(NULLIF(TRIM(source), ''), 'unknown') AS source, count(*)::int AS n
      FROM investors GROUP BY 1 ORDER BY n DESC LIMIT 12`
    return rows as any[]
  } catch {
    return []
  }
}

const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString())
const pct = (part: number | null, total: number | null) =>
  part == null || total == null || total === 0 ? "" : `${Math.round((part / total) * 100)}%`

export default async function DataOpsPage() {
  const [investors, firms, withEmail, withLinkedIn, enriched, staleEnrich, sources] = await Promise.all([
    n(sql`SELECT count(*)::int AS n FROM investors`),
    n(sql`SELECT count(*)::int AS n FROM investment_firms`),
    n(sql`SELECT count(*)::int AS n FROM investors WHERE email IS NOT NULL AND email <> ''`),
    n(sql`SELECT count(*)::int AS n FROM investors WHERE linkedin_url IS NOT NULL AND linkedin_url <> ''`),
    n(sql`SELECT count(*)::int AS n FROM investors WHERE enrichment_status = 'enriched' OR last_enrichment_date IS NOT NULL`),
    n(sql`SELECT count(*)::int AS n FROM investors WHERE last_enrichment_date IS NULL AND (enrichment_status IS NULL OR enrichment_status <> 'enriched')`),
    bySource(),
  ])

  const rows: { label: string; value: number | null; hint: string }[] = [
    { label: "Investors", value: investors, hint: "Global — shared by every tenant" },
    { label: "Investment firms", value: firms, hint: "Global firm records" },
    { label: "With email", value: withEmail, hint: `${pct(withEmail, investors)} of investors` },
    { label: "With LinkedIn", value: withLinkedIn, hint: `${pct(withLinkedIn, investors)} of investors` },
    { label: "Enriched", value: enriched, hint: `${pct(enriched, investors)} of investors` },
    { label: "Awaiting enrichment", value: staleEnrich, hint: `${pct(staleEnrich, investors)} of investors` },
  ]

  return (
    <PageShell
      eyebrow="Data & growth"
      title="Data operations"
      description="Health of the global investor database — the pipeline behind every tenant’s Discover, Find-Investors, and Matchmaking. Import / crawl / enrich jobs run against this shared store."
      action={<RefreshButton />}
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((r) => (
          <StatTile key={r.label} label={r.label} value={fmt(r.value)} hint={r.hint} />
        ))}
      </div>

      <h2 className="font-display text-lg mt-8 mb-3">Records by source</h2>
      {sources.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          No source breakdown available (the <code>investors.source</code> column may be empty or the table unreachable).
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2.5">Source</th>
                <th className="text-right px-4 py-2.5">Records</th>
                <th className="text-left px-4 py-2.5 w-1/2">Share</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => {
                const share = investors && investors > 0 ? (s.n / investors) * 100 : 0
                return (
                  <tr key={s.source} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{s.source}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{s.n.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-foreground/[0.08] overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(share, 1)}%`, background: "var(--accent)" }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground tabular-nums w-9 text-right">{Math.round(share)}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-xs text-muted-foreground max-w-2xl">
        Import (CSV/XLSX), web crawl, enrichment, URL-check and email-verification jobs write into this same shared
        store. This panel is the platform-wide read model over their output; job triggers are exposed to superadmins
        as they migrate off the tenant Owner Console.
      </p>
    </PageShell>
  )
}
