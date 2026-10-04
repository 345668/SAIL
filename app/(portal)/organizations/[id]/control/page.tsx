import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { FEATURES, LIMITS, canMove, loadControl, minRoleFor, roleAtLeast, STATES, MIN_REASON } from "@/lib/tenant-control"
import { changeState, savePlan } from "./actions"

export const dynamic = "force-dynamic"
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—")
const card = "rounded-xl border border-border card-elev p-5"
const input = "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
const btn = "h-9 px-4 rounded-md text-sm"
const TONE: Record<string, string> = { active: "bg-emerald-500/15 text-emerald-700", trial: "bg-blue-500/15 text-blue-700", paused: "bg-amber-500/15 text-amber-700", offboarding: "bg-red-500/15 text-red-700" }

export default async function ControlPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { id } = await params
  const { err, ok } = await searchParams
  const staff = await getSession()
  if (!staff) redirect("/login")
  const c = await loadControl(id)
  if (!c) notFound()
  const admin = roleAtLeast(staff.role, "admin")
  const planOf = c.plans.find((p) => p.plan === c.plan)
  const effective = (k: string) => (k in c.features ? c.features[k] : planOf ? planOf.features[k] === true : true)
  return (
    <PageShell eyebrow="Organizations" title={`${c.org.name}: plan and state`} description="What this workspace may use, and whether it is running. Open by default: with no plan set, everything is allowed. Changes need a reason, are audited, and appear in the workspace's own access log.">
      <p className="mb-4 text-sm"><Link className="underline" href="/organizations">← Organizations</Link> · <Link className="underline" href={`/organizations/${encodeURIComponent(id)}`}>Inspect usage</Link> · <Link className="underline" href={`/organizations/${encodeURIComponent(id)}/requests`}>Export and erasure</Link></p>
      {err && <p className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {!admin && <p className="mb-4 text-sm text-muted-foreground">You can read this. Changing it needs an admin.</p>}

      <section className={card}>
        <div className="flex items-center gap-3"><h2 className="text-base font-semibold">State</h2><span className={`rounded px-2 py-0.5 text-xs font-medium ${TONE[c.state]}`}>{c.state}</span><span className="text-xs text-muted-foreground">since {fmt(c.stateChangedAt)}{c.stateReason ? ` · ${c.stateReason}` : ""}</span></div>
        <p className="mt-1 text-sm text-muted-foreground">Paused or closing: AI runs, sending, the intake form and document conversion stop. Sign-in, reading and export stay.</p>
        {admin && (
          <form action={changeState} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="orgId" value={id} />
            <label className="text-sm">Move to<select name="to" className={input} required defaultValue="">
              <option value="" disabled>Choose…</option>
              {STATES.filter((s) => canMove(c.state, s)).map((s) => <option key={s} value={s} disabled={!roleAtLeast(staff.role, minRoleFor(s))}>{s}{!roleAtLeast(staff.role, minRoleFor(s)) ? " (superadmin only)" : ""}</option>)}
            </select></label>
            <label className="text-sm">Trial ends (if trial)<input type="date" name="trialEnds" className={input} /></label>
            <label className="min-w-[260px] flex-1 text-sm">Reason<input name="reason" required minLength={MIN_REASON} maxLength={500} className={input} placeholder="Invoice unpaid after 30 days, ticket 123" /></label>
            <button className={btn} style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>Change state</button>
          </form>)}
        {c.events.length > 0 && <ul className="mt-4 text-xs text-muted-foreground">{c.events.map((e, i) => <li key={i}>{fmt(e.at)} · {e.from ?? "—"} to <b>{e.to}</b> · {e.actor} · {e.reason}</li>)}</ul>}
      </section>

      <form action={savePlan} className={`${card} mt-4`}>
        <input type="hidden" name="orgId" value={id} /><input type="hidden" name="version" value={c.version} />
        <h2 className="text-base font-semibold">Plan and overrides</h2>
        <label className="mt-3 block max-w-xs text-sm">Plan<select name="plan" defaultValue={c.plan ?? ""} disabled={!admin} className={input}>
          <option value="">No plan (open: everything allowed)</option>{c.plans.map((p) => <option key={p.plan} value={p.plan}>{p.label}{p.persona ? ` (${p.persona === "vc" ? "fund" : p.persona})` : ""}{p.priceMonth ? ` · €${p.priceMonth}/mo` : p.priceMonth === 0 ? " · free" : " · contract"}{p.status === "retired" ? " · retired" : ""}</option>)}</select></label>
        {planOf?.summary && <p className="mt-2 text-sm text-muted-foreground">{planOf.summary}</p>}
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div><div className="text-xs font-medium text-muted-foreground">Modules</div>
            {FEATURES.map((f) => (
              <div key={f.key} className="mt-2 flex items-center justify-between gap-3 text-sm">
                <span>{f.label}<span className="ml-2 text-xs text-muted-foreground">now {effective(f.key) ? "on" : "off"}</span></span>
                <select name={`f_${f.key}`} disabled={!admin} defaultValue={f.key in c.features ? (c.features[f.key] ? "on" : "off") : "plan"} className="rounded-md border border-border bg-card px-2 py-1 text-xs">
                  <option value="plan">Follow plan</option><option value="on">Force on</option><option value="off">Force off</option></select>
              </div>))}</div>
          <div><div className="text-xs font-medium text-muted-foreground">Limits (blank follows the plan, "unlimited" removes it)</div>
            {LIMITS.map((l) => (
              <label key={l.key} className="mt-2 flex items-center justify-between gap-3 text-sm"><span>{l.label}<span className="ml-2 text-xs text-muted-foreground">plan: {planOf ? (planOf.limits[l.key] ?? "unlimited") : "none"}</span></span>
                <input name={`l_${l.key}`} disabled={!admin} defaultValue={l.key in c.limits ? (c.limits[l.key] === null ? "unlimited" : String(c.limits[l.key])) : ""} className="w-28 rounded-md border border-border bg-card px-2 py-1 text-xs" /></label>))}</div>
        </div>
        <label className="mt-4 block text-sm">Notes (internal)<input name="notes" defaultValue={c.notes ?? ""} disabled={!admin} maxLength={500} className={input} /></label>
        {admin && <label className="mt-3 block text-sm">Reason for this change<input name="reason" required minLength={MIN_REASON} maxLength={500} className={input} placeholder="Agreed upgrade to Pro, ticket 123" /></label>}
        {admin && <button className={`${btn} mt-4`} style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>Save plan</button>}
        <p className="mt-3 text-xs text-muted-foreground">Anker picks changes up within 30 seconds. Version {c.version || "(no plan set yet)"}.</p>
      </form>
    </PageShell>
  )
}
