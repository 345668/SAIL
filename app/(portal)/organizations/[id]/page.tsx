import { notFound } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { tenantSummary, validInspection, MIN_REASON } from "@/lib/inspect"
import { beginInspection } from "./actions"

export const dynamic = "force-dynamic"

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—")

export default async function TenantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ i?: string; err?: string }> }) {
  const { id } = await params
  const { i, err } = await searchParams
  const staff = await getSession()
  if (!staff) notFound()
  const grant = i ? await validInspection(staff.id, id, Number(i)) : null

  if (!grant) {
    return (
      <PageShell eyebrow="Organizations" title="Inspect workspace" description="Metadata only: plan, usage, errors and counts. Never deals, notes, contacts or messages. The workspace's own managers will see that you looked, when, and why.">
        {i && <p className="mb-4 text-sm text-[var(--danger)]">That inspection has expired or is not yours. Start a new one.</p>}
        {err && <p className="mb-4 text-sm text-[var(--danger)]">{err}</p>}
        <form action={beginInspection} className="max-w-lg space-y-3">
          <input type="hidden" name="orgId" value={id} />
          <label className="block text-sm">Reason (support ticket, incident, billing question)
            <textarea name="reason" required minLength={MIN_REASON} maxLength={500} rows={3} className="mt-1 w-full rounded-md border border-border bg-card p-2 text-sm" />
          </label>
          <button className="h-9 px-4 rounded-md text-sm" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>Start 15-minute inspection</button>
        </form>
      </PageShell>
    )
  }

  const s = await tenantSummary(id)
  if (!s) notFound()
  const card = "rounded-xl border border-border card-elev p-4"
  return (
    <PageShell eyebrow="Organizations" title={s.org.name} description={`Inspection open until ${fmt(grant.expiresAt.toISOString())}. Reason: ${grant.reason}`}>
      <div className="grid gap-4 md:grid-cols-3">
        <div className={card}><div className="text-xs text-muted-foreground">Workspace</div>
          <div className="mt-1 text-sm">{s.org.kind}{s.org.archivedAt ? " (archived)" : ""}</div>
          <div className="text-xs text-muted-foreground">Created {fmt(s.org.createdAt)}</div>
          <div className="text-xs text-muted-foreground">Last AI activity {fmt(s.lastActivity)}</div></div>
        <div className={card}><div className="text-xs text-muted-foreground">Billing</div>
          <div className="mt-1 text-sm">{s.billing ? `${s.billing.status} · ${s.billing.plan ?? "no plan"}` : "No subscription"}</div>
          {s.billing?.periodEnd && <div className="text-xs text-muted-foreground">Renews {fmt(s.billing.periodEnd)}</div>}</div>
        <div className={card}><div className="text-xs text-muted-foreground">AI, last 30 days</div>
          <div className="mt-1 text-sm">{s.ai.calls30d} calls · {s.ai.failed30d} failed · ${s.ai.cost30d.toFixed(2)}</div></div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className={card}><div className="mb-2 text-xs text-muted-foreground">Members (by role and persona)</div>
          {s.members.map((m, k) => <div key={k} className="text-sm">{m.count} × {m.role}{m.persona ? ` · ${m.persona}` : ""}</div>)}</div>
        <div className={card}><div className="mb-2 text-xs text-muted-foreground">Record counts (numbers only)</div>
          {s.counts.map((c) => <div key={c.label} className="flex justify-between text-sm"><span>{c.label}</span><span className="tabular-nums">{c.n}</span></div>)}</div>
      </div>
      <div className={`${card} mt-4`}><div className="mb-2 text-xs text-muted-foreground">AI by task, last 30 days</div>
        {s.ai.byTask.length === 0 ? <div className="text-sm text-muted-foreground">No calls.</div> : s.ai.byTask.map((t) => (
          <div key={t.task} className="flex justify-between text-sm"><span>{t.task}</span><span className="tabular-nums">{t.calls} calls · {t.failed} failed · ${t.cost.toFixed(3)}</span></div>))}</div>
    </PageShell>
  )
}
