import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast } from "@/lib/tenant-control"
import { getEconomics, type Economics } from "@/lib/unit-economics"
import { saveBillAction } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const input = "h-8 rounded-md border border-border bg-card px-2 text-xs"
const btn = "h-8 rounded-md border border-border px-3 text-xs"
const usd = (n: number | null) => n == null ? "—" : `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`

export default async function UnitEconomicsPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  let e: Economics | null = null, error: string | null = null
  try { e = await getEconomics(staff) } catch (x) { error = (x as Error).message }
  const listTotal = e ? e.totals.aiUsd + e.totals.unitsUsd : 0
  const billed = e ? e.bills.filter((b) => b.month === e!.month.slice(0, 7)).reduce((a, b) => a + b.amountUsd, 0) : 0
  return (
    <PageShell eyebrow="Platform" title="Unit economics" description="What this month's AI and media use costs at list price, which workspaces use it, and what one job costs. Totals are list prices (and some are estimates); the provider's real bill is entered below so you can compare. Free-tier use is counted at list price, so the gap is your margin from it.">
      {(err || error) && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err ?? error}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {e && (
        <div className="space-y-4">
          <section className={card}>
            <h2 className="text-sm font-semibold">{e.month.slice(0, 7)} so far</h2>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">List price, all</dt><dd className="text-lg">{usd(listTotal)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Chat and drafting</dt><dd className="text-lg">{usd(e.totals.aiUsd)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Speech, search, documents, media</dt><dd className="text-lg">{usd(e.totals.unitsUsd)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Platform jobs (no customer)</dt><dd className="text-lg">{usd(e.totals.platformUsd)}</dd></div>
            </dl>
            <p className="mt-3 text-sm">Provider bills entered for this month: <strong>{usd(billed)}</strong>{billed > 0 ? ` (${listTotal > 0 ? Math.round((billed / listTotal) * 100) : 0}% of list price)` : ". None yet."}</p>
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold">Workspaces, largest first</h2>
            <table className="mt-2 w-full text-left text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="py-1">Workspace</th><th>Used</th><th>Limit</th><th>Share</th></tr></thead>
              <tbody>{e.workspaces.map((w) => <tr key={w.orgId} className="border-t border-border"><td className="py-1.5">{w.name ?? w.orgId}</td><td>{usd(w.usd)}</td><td>{w.limit == null ? "none" : usd(w.limit)}</td><td className={w.pct != null && w.pct >= 1 ? "text-[var(--danger)]" : ""}>{w.pct == null ? "—" : `${Math.round(w.pct * 100)}%`}</td></tr>)}</tbody></table>
            {e.workspaces.length === 0 && <p className="text-sm text-muted-foreground">No workspace has used anything this month.</p>}
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold">Cost of one job, by task</h2>
            <p className="mb-2 text-xs text-muted-foreground">A job is one run (one assistant question, one matching run). Median and 95th percentile of the cost per run. This is the number to know before publishing any usage-based price.</p>
            <table className="w-full text-left text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="py-1">Task</th><th>Runs</th><th>Calls</th><th>Total</th><th>Typical (p50)</th><th>Worst (p95)</th></tr></thead>
              <tbody>{e.tasks.map((t) => <tr key={t.task} className="border-t border-border"><td className="py-1.5 font-mono text-xs">{t.task}</td><td>{t.runs}</td><td>{t.calls}</td><td>{usd(t.usd)}</td><td>{usd(t.p50)}</td><td>{usd(t.p95)}</td></tr>)}</tbody></table>
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold">Speech, search, documents and media</h2>
            <table className="mt-2 w-full text-left text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="py-1">Unit</th><th>Events</th><th>Quantity</th><th>Cost</th></tr></thead>
              <tbody>{e.units.map((u) => <tr key={u.unit} className="border-t border-border"><td className="py-1.5 font-mono text-xs">{u.unit}</td><td>{u.events}</td><td>{Math.round(u.qty).toLocaleString("en")}</td><td>{usd(u.usd)}</td></tr>)}</tbody></table>
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold">Provider bills</h2>
            <table className="mt-2 w-full text-left text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="py-1">Month</th><th>Provider</th><th>Billed</th><th>Note</th></tr></thead>
              <tbody>{e.bills.map((b) => <tr key={b.month + b.provider} className="border-t border-border"><td className="py-1.5">{b.month}</td><td>{b.provider}</td><td>{usd(b.amountUsd)}</td><td className="text-muted-foreground">{b.note}</td></tr>)}</tbody></table>
            {admin && (
              <form action={saveBillAction} className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <span className="text-xs font-medium">Enter a bill</span>
                <input className={`${input} w-24`} name="month" placeholder="2026-10" aria-label="Month" />
                <input className={`${input} w-32`} name="provider" placeholder="dashscope" aria-label="Provider" />
                <input className={`${input} w-24`} name="amountUsd" placeholder="USD" aria-label="Amount in US dollars" />
                <input className={`${input} w-40`} name="note" placeholder="note" aria-label="Note" />
                <button className={btn}>Save</button>
              </form>)}
          </section>
        </div>)}
    </PageShell>
  )
}
