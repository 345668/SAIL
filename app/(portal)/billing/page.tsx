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

async function spendByProvider(): Promise<{ provider: string; cost: number; events: number }[]> {
  try {
    const rows = await sql`
      SELECT provider,
             COALESCE(SUM(cost_usd), 0)::float8 AS cost,
             count(*)::int AS events
      FROM platform_usage_events
      WHERE occurred_at >= now() - interval '30 days'
      GROUP BY provider ORDER BY cost DESC`
    return rows as any[]
  } catch {
    return []
  }
}

const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString())
const usd = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default async function BillingPage() {
  const [orgs, keys, staff, investors, spend] = await Promise.all([
    n(sql`SELECT count(*)::int AS n FROM organizations`),
    n(sql`SELECT count(*)::int AS n FROM platform_api_keys WHERE NOT disabled`),
    n(sql`SELECT count(*)::int AS n FROM company_staff WHERE NOT disabled`),
    n(sql`SELECT count(*)::int AS n FROM investors`),
    spendByProvider(),
  ])

  const total30d = spend.reduce((s, r) => s + (r.cost || 0), 0)
  const hasSpend = spend.length > 0

  return (
    <PageShell
      eyebrow="Governance"
      title="Billing & credits"
      description="Platform cost monitoring — AI-router spend, storage and seats — plus the inventory that drives it. Per-org plans and invoicing land in a later phase."
      action={<RefreshButton />}
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="30-day AI spend" value={hasSpend ? usd(total30d) : "—"} hint="Across platform providers" />
        <StatTile label="Active platform keys" value={fmt(keys)} hint="Metered providers" />
        <StatTile label="Tenant organizations" value={fmt(orgs)} hint="Billable workspaces" />
        <StatTile label="Investor records" value={fmt(investors)} hint="Storage driver" />
      </div>

      <h2 className="font-display text-lg mt-8 mb-3">AI spend by provider — last 30 days</h2>
      {!hasSpend ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          No usage recorded yet. Cost events are written to <code>platform_usage_events</code>
          {" "}(provider, cost_usd, tokens, occurred_at) by the AI router; once it reports, spend rolls up here by
          provider. Until then the inventory tiles above still reflect real billable state.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2.5">Provider</th>
                <th className="text-right px-4 py-2.5">Events</th>
                <th className="text-right px-4 py-2.5">Cost (30d)</th>
                <th className="text-left px-4 py-2.5 w-1/2">Share</th>
              </tr>
            </thead>
            <tbody>
              {spend.map((r) => {
                const share = total30d > 0 ? (r.cost / total30d) * 100 : 0
                return (
                  <tr key={r.provider} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{r.provider}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{r.events.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{usd(r.cost)}</td>
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

      <p className="mt-6 text-xs text-muted-foreground">
        {fmt(staff)} staff seat{staff === 1 ? "" : "s"} have portal access. Seat, storage and API spend combine into the
        platform cost line; per-tenant allocation arrives with the plans/invoicing phase.
      </p>
    </PageShell>
  )
}
