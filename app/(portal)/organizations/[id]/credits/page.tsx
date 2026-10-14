import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { ADMIN_GRANT_CEILING, loadCredits, MAX_GRANT } from "@/lib/studio-credits"
import { grant, revoke } from "./actions"

export const dynamic = "force-dynamic"
const nf = new Intl.NumberFormat("en")
const fmt = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
const card = "rounded-xl border border-border card-elev p-5"
const input = "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
const btn = "h-9 px-4 rounded-md text-sm"
const KIND: Record<string, string> = { spend: "Used", refund: "Returned", grant: "Granted", revoke: "Taken back", adjust: "Adjusted" }
const SOURCE: Record<string, string> = { plan: "from the plan", override: "set for this workspace", default: "platform default" }

export default async function CreditsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { id } = await params
  const { err, ok } = await searchParams
  const staff = await getSession()
  if (!staff) redirect("/login")
  const c = await loadCredits(id)
  if (!c) notFound()
  const admin = roleAtLeast(staff.role, "admin")
  const left = c.allowance === null ? null : Math.max(0, c.allowance - c.usedToday)
  const max = Math.max(1, ...c.week.map((w) => w.spent))
  const base = `/organizations/${encodeURIComponent(id)}`
  return (
    <PageShell eyebrow="Organizations" title={`${c.org.name}: Studio credits`} description="The daily allowance and bonus credits for the AI Media Studio. The allowance resets at 00:00 UTC; bonus credits are spent after it and do not reset.">
      <p className="mb-4 text-sm"><Link className="underline" href="/organizations">← Organizations</Link> · <Link className="underline" href={`${base}/control`}>Plan and daily allowance</Link> · <Link className="underline" href="/studio-credits">Price list</Link></p>
      {err && <p className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {!admin && <p className="mb-4 text-sm text-muted-foreground">You can read this. Granting or taking back credits needs an admin.</p>}

      <div className="grid gap-4 md:grid-cols-4">
        <div className={card}><div className="text-xs text-muted-foreground">Daily allowance</div><div className="mt-1 text-2xl font-semibold">{c.allowance === null ? "Unlimited" : nf.format(c.allowance)}</div><div className="mt-1 text-xs text-muted-foreground">{SOURCE[c.source]}{c.plan ? ` (${c.plan})` : ""}</div></div>
        <div className={card}><div className="text-xs text-muted-foreground">Used today</div><div className="mt-1 text-2xl font-semibold">{nf.format(c.usedToday)}</div><div className="mt-1 text-xs text-muted-foreground">{left === null ? "no limit" : `${nf.format(left)} left of the allowance`}</div></div>
        <div className={card}><div className="text-xs text-muted-foreground">Bonus credits</div><div className="mt-1 text-2xl font-semibold">{nf.format(c.bonus)}</div><div className="mt-1 text-xs text-muted-foreground">spent after the allowance</div></div>
        <div className={card}><div className="text-xs text-muted-foreground">Generations, 7 days</div><div className="mt-1 text-2xl font-semibold">{nf.format(c.jobs7d)}</div><div className="mt-1 text-xs text-muted-foreground">all members</div></div>
      </div>

      <section className={`${card} mt-4`}>
        <h2 className="text-base font-semibold">Credits used per day</h2>
        <div className="mt-3 flex items-end gap-2" role="img" aria-label={`Credits used each of the last 7 days: ${c.week.map((w) => `${w.day} ${w.spent}`).join(", ")}`}>
          {c.week.map((w) => (
            <div key={w.day} className="flex flex-1 flex-col items-center gap-1 text-xs">
              <span className="text-muted-foreground">{nf.format(w.spent)}</span>
              <div className="w-full rounded-sm bg-primary/70" style={{ height: `${Math.max(2, Math.round((w.spent / max) * 80))}px` }} />
              <span className="text-muted-foreground">{w.day.slice(5)}</span>
            </div>))}
        </div>
      </section>

      {admin && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <form action={grant} className={card}>
            <input type="hidden" name="orgId" value={id} />
            <h2 className="text-base font-semibold">Give bonus credits</h2>
            <p className="mt-1 text-sm text-muted-foreground">A reward, a goodwill gesture or a trial extension. Up to {nf.format(ADMIN_GRANT_CEILING)} for an admin, up to {nf.format(MAX_GRANT)} for a superadmin.</p>
            <label className="mt-3 block text-sm">Credits<input type="number" name="credits" min={1} max={MAX_GRANT} step={1} required className={input} placeholder="e.g. 2000" /></label>
            <label className="mt-3 block text-sm">Reason (the workspace's managers can see it)<input name="reason" required minLength={MIN_REASON} maxLength={500} className={input} placeholder="Reward for the pilot feedback, ticket 77" /></label>
            <button className={`${btn} mt-4`} style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>Give credits</button>
          </form>
          <form action={revoke} className={card}>
            <input type="hidden" name="orgId" value={id} />
            <h2 className="text-base font-semibold">Take back bonus credits</h2>
            <p className="mt-1 text-sm text-muted-foreground">Only unspent bonus credits can be taken back ({nf.format(c.bonus)} now). The daily allowance is changed on the plan page.</p>
            <label className="mt-3 block text-sm">Credits<input type="number" name="credits" min={1} max={Math.max(1, c.bonus)} step={1} required className={input} /></label>
            <label className="mt-3 block text-sm">Reason<input name="reason" required minLength={MIN_REASON} maxLength={500} className={input} placeholder="Granted to the wrong workspace, ticket 78" /></label>
            <button className={`${btn} mt-4 border border-border`} disabled={c.bonus === 0}>Take back</button>
          </form>
        </div>)}

      <section className={`${card} mt-4`}>
        <h2 className="text-base font-semibold">Recent movements</h2>
        {c.ledger.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No credits have moved yet.</p> : (
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">When</th><th className="pr-3 font-medium">What</th><th className="pr-3 text-right font-medium">Credits</th><th className="pr-3 font-medium">From</th><th className="font-medium">Reason</th></tr></thead>
            <tbody>{c.ledger.map((r, i) => (
              <tr key={i} className="border-t border-border"><td className="py-1.5 pr-3 whitespace-nowrap">{fmt(r.at)}</td><td className="pr-3">{KIND[r.kind] ?? r.kind}</td><td className={`pr-3 text-right tabular-nums ${r.credits < 0 ? "" : "text-emerald-700"}`}>{r.credits > 0 ? "+" : ""}{nf.format(r.credits)}</td><td className="pr-3">{r.source === "bonus" ? "bonus" : "daily"}</td><td className="text-muted-foreground">{r.reason ?? ""}{r.actor ? ` · ${r.actor}` : ""}</td></tr>))}</tbody></table></div>)}
      </section>
    </PageShell>
  )
}
