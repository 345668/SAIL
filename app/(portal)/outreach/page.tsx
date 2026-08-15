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

async function grouped(q: Promise<any[]>): Promise<{ k: string; n: number }[]> {
  try {
    return (await q) as any[]
  } catch {
    return []
  }
}

const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString())

function Breakdown({ title, rows, empty }: { title: string; rows: { k: string; n: number }[]; empty: string }) {
  const total = rows.reduce((s, r) => s + r.n, 0)
  return (
    <div>
      <h2 className="font-display text-lg mb-3">{title}</h2>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">{empty}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => {
                const share = total > 0 ? (r.n / total) * 100 : 0
                return (
                  <tr key={r.k} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs w-48">{r.k || "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums w-20">{r.n.toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <div className="h-1.5 rounded-full bg-foreground/[0.08] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(share, 1)}%`, background: "var(--accent)" }} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default async function OutreachPage() {
  const [total, sent, queued, replies, byStatus, byClass] = await Promise.all([
    n(sql`SELECT count(*)::int AS n FROM outreach_messages`),
    n(sql`SELECT count(*)::int AS n FROM outreach_messages WHERE status IN ('sent','delivered')`),
    n(sql`SELECT count(*)::int AS n FROM outreach_messages WHERE status IN ('queued','approved')`),
    n(sql`SELECT count(*)::int AS n FROM outreach_replies`),
    grouped(sql`SELECT status AS k, count(*)::int AS n FROM outreach_messages GROUP BY status ORDER BY n DESC`),
    grouped(sql`SELECT COALESCE(classification,'unclassified') AS k, count(*)::int AS n FROM outreach_replies GROUP BY 1 ORDER BY n DESC`),
  ])

  return (
    <PageShell
      eyebrow="Data & growth"
      title="Send Center"
      description="Platform-level send / track / triage over the shared sending identity (vc@an-ker.de) and the cross-user inbox. Read model over outreach_messages and outreach_replies."
      action={<RefreshButton />}
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatTile label="Total messages" value={fmt(total)} hint="All outreach, all steps" />
        <StatTile label="Sent / delivered" value={fmt(sent)} />
        <StatTile label="Queued / approved" value={fmt(queued)} hint="Awaiting the send window" />
        <StatTile label="Replies" value={fmt(replies)} hint="Inbound, classified" />
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        <Breakdown title="Outbox by status" rows={byStatus} empty="outreach_messages is empty or unreachable." />
        <Breakdown title="Replies by classification" rows={byClass} empty="No replies classified yet." />
      </div>

      <p className="mt-6 text-xs text-muted-foreground max-w-2xl">
        Draft → approve → queue → send runs through Resend on the platform identity; open/click and bounce/complaint
        events flow back onto each message. Reply triage classifies inbound and drafts a response for approval before
        advancing the CRM stage.
      </p>
    </PageShell>
  )
}
