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
      <div className={`${card} mt-4`}>
        <div className="flex items-center gap-2 text-sm"><span className="text-xs text-muted-foreground">Health</span>
          <span className="font-medium">{s.health.score}/100 · {s.health.label}</span></div>
        {s.health.reasons.length === 0 ? <div className="mt-1 text-xs text-muted-foreground">No problems detected.</div> :
          <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{s.health.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        <div className="mt-1 text-[11px] text-muted-foreground">Rule-based: billing state, AI failure rate, 14-day inactivity, bounces, complaints, mailbox errors.</div>
      </div>
      <div className={`${card} mt-4`}><div className="mb-2 text-xs text-muted-foreground">AI calls per day, last 30 days (red = failed)</div>
        <div className="flex h-16 items-end gap-0.5">
          {s.daily.map((d) => { const max = Math.max(...s.daily.map((x) => x.calls), 1); return (
            <div key={d.day} title={`${d.day}: ${d.calls} calls, ${d.failed} failed`} className="flex-1 min-w-[3px] rounded-sm" style={{ height: `${Math.max(4, (100 * d.calls) / max)}%`, background: d.failed ? "var(--danger)" : "var(--primary)" }} />) })}
          {s.daily.length === 0 && <div className="text-sm text-muted-foreground">No calls.</div>}
        </div></div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className={card}><div className="mb-2 text-xs text-muted-foreground">Outreach, 30 days</div>
          <div className="text-sm">{s.outreach.sent} sent · {s.outreach.replies} replies</div>
          <div className="text-xs text-muted-foreground">{s.outreach.bounced} bounced · {s.outreach.complained} complaints</div></div>
        <div className={card}><div className="mb-2 text-xs text-muted-foreground">Agents, 30 days</div>
          <div className="text-sm">{s.agentRuns.runs} runs · {s.agentRuns.errored} errored</div></div>
        <div className={card}><div className="mb-2 text-xs text-muted-foreground">Data room and mailboxes</div>
          <div className="text-sm">{s.storage.files} files · {(s.storage.bytes / 1048576).toFixed(1)} MB</div>
          <div className="text-xs text-muted-foreground">{s.mailboxes.length ? s.mailboxes.map((m) => `${m.n} ${m.status}`).join(", ") : "No mailbox connected"}</div></div>
      </div>
      {s.errors.length > 0 && <div className={`${card} mt-4`}><div className="mb-2 text-xs text-muted-foreground">Failed AI calls by status</div>
        {s.errors.map((e) => <div key={e.status} className="flex justify-between text-sm"><span>{e.status}</span><span className="tabular-nums">{e.n}</span></div>)}</div>}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className={card}><div className="mb-2 text-xs text-muted-foreground">Members (by role and persona)</div>
          {s.members.map((m, k) => <div key={k} className="text-sm">{m.count} × {m.role}{m.persona ? ` · ${m.persona}` : ""}</div>)}</div>
        <div className={card}><div className="mb-2 text-xs text-muted-foreground">Record counts (numbers only)</div>
          {s.counts.map((c) => <div key={c.label} className="flex justify-between text-sm"><span>{c.label}</span><span className="tabular-nums">{c.n}</span></div>)}</div>
      </div>
      <div className={`${card} mt-4`}><div className="mb-2 text-xs text-muted-foreground">AI by task, last 30 days</div>
        {s.ai.byTask.length === 0 ? <div className="text-sm text-muted-foreground">No calls.</div> : s.ai.byTask.map((t) => (
          <div key={t.task} className="flex justify-between text-sm"><span>{t.task}</span><span className="tabular-nums">{t.calls} calls · {t.failed} failed · ${t.cost.toFixed(3)}</span></div>))}</div>
      <div className={`${card} mt-4`}><div className="mb-2 text-xs text-muted-foreground">Who inspected this workspace (visible to the tenant's managers)</div>
        {s.inspections.map((x, k) => <div key={k} className="text-sm"><span className="tabular-nums text-muted-foreground">{fmt(x.at)}</span> · {x.by} · {x.reason}</div>)}</div>
    </PageShell>
  )
}
