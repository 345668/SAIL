import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { drillOverview, daysSince, type DrillOverview } from "@/lib/restore-drill"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"

export default async function RestoreDrillPage() {
  const staff = await getSession(); if (!staff) redirect("/login")
  let o: DrillOverview | null = null, error: string | null = null
  try { o = await drillOverview(staff) } catch (e) { error = (e as Error).message }
  const age = daysSince(o?.lastPassedAt ?? null), overdue = !o || age === null || age > o.overdueAfterDays
  return (
    <PageShell eyebrow="Platform" title="Restore drill" description="Proof that production's data can be restored from Neon's history, and how long it takes. The founder runs the drill in a terminal (docs/runbooks/restore.md); this page shows the result. Counts and timings only: no data is read or shown.">
      {error && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{error}</p>}
      {o && (
        <div className="space-y-4">
          <section className={card}>
            <h2 className="text-sm font-semibold">Last passing drill</h2>
            <p className={`mt-2 text-sm ${overdue ? "text-[var(--danger)]" : ""}`}>{o.lastPassedAt ? `${new Date(o.lastPassedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} (${age} day${age === 1 ? "" : "s"} ago)${overdue ? `: older than ${o.overdueAfterDays} days, so the alert is open.` : "."}` : "None yet. A restore has never been tried, so how long recovery takes is unknown, and the alert is open until a drill passes."}</p>
            <p className="mt-2 text-xs text-muted-foreground">Run it quarterly. It is read-only and deletes its own branch.</p>
          </section>
          <section className={card}>
            <h2 className="text-sm font-semibold">Recent drills</h2>
            {o.drills.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No drill has been recorded.</p> : (
              <ul className="mt-2 divide-y divide-border">{o.drills.map((d) => (
                <li key={d.startedAt} className="py-3 text-sm">
                  <p><strong className={d.passed ? "" : "text-[var(--danger)]"}>{d.passed ? "Passed" : "Failed"}</strong> · {new Date(d.startedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · restored as of {d.ageMin} min earlier · {d.seconds ?? "?"} s · {d.tablesChecked} tables compared, {d.tablesOff} off{d.branchDeleted === false ? " · branch NOT deleted: remove it in Neon" : ""}</p>
                  {d.error && <p className="mt-1 text-xs text-[var(--danger)]">{d.error}</p>}
                  {d.offTables.map((t) => <p key={t.table} className="mt-1 text-xs text-muted-foreground">{t.table}: production {t.production}, restored {t.restored}, expected about {t.expected}</p>)}
                </li>))}</ul>)}
          </section>
        </div>)}
    </PageShell>
  )
}
