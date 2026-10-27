import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast } from "@/lib/tenant-control"
import { halyardOverview, type HalyardOverview } from "@/lib/halyard"
import { switchAction } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const btn = "h-8 rounded-md border border-border px-3 text-xs"
const secs = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`)

export default async function HalyardPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  let o: HalyardOverview | null = null, error: string | null = null
  try { o = await halyardOverview(staff) } catch (e) { error = (e as Error).message }
  const h = o?.health
  return (
    <PageShell eyebrow="Platform" title="Halyard" description="The live call assistant. This page shows counts, timings and health only. The platform never sees a call: no transcript, title, note or suggestion is read here or returned by the app.">
      {(err || error) && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err ?? error}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {o && h && (
        <div className="space-y-4">
          <section className={card}>
            <h2 className="text-sm font-semibold">Platform switch</h2>
            <p className="mt-1 text-sm">Halyard is <strong>{o.flagOn ? "ON" : "OFF"}</strong>. {o.flagOn ? "Workspaces whose plan includes it can start sessions." : "Nobody can start a session, and any session open stops at once."} Whoever is already in a call keeps their data: reading, exporting and deleting always work.</p>
            {admin ? <form action={switchAction} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="on" value={o.flagOn ? "0" : "1"} />
              <input name="reason" required minLength={5} placeholder={o.flagOn ? "Why switch it off? (audited)" : "Why switch it on? (audited)"} aria-label="Reason" className="h-8 w-80 rounded-md border border-border bg-card px-2 text-xs" />
              <button className={btn}>{o.flagOn ? "Switch Halyard off" : "Switch Halyard on"}</button>
            </form> : <p className="mt-2 text-xs text-muted-foreground">Only admins can change this.</p>}
            <p className="mt-3 text-xs text-muted-foreground">One workspace only: open it under Organisations and set the <code>halyard</code> feature (and the listening minutes and live sessions limits) in its overrides. The plan decides who has it by default (600 listening minutes a month).</p>
          </section>
          <section className={card}>
            <h2 className="text-sm font-semibold">Health, last {h.windowMin} minutes</h2>
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Suggestions</dt><dd>{h.suggestions}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Time to a suggestion, typical / slowest 5%</dt><dd className={h.p95Ms != null && h.p95Ms > 4000 && h.suggestions >= 20 ? "text-[var(--danger)]" : ""}>{secs(h.p50Ms)} / {secs(h.p95Ms)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Audio uploads</dt><dd>{h.uploads}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Transcription failures</dt><dd className={h.failureRate != null && h.failureRate > 0.1 && h.uploads >= 10 ? "text-[var(--danger)]" : ""}>{h.failed}{h.failureRate != null ? ` (${Math.round(h.failureRate * 100)}%)` : ""}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">Alerts: slow suggestions (slowest 5% over 4 s with at least 20 suggestions) and failing transcription (over 10% of at least 10 uploads), both severity 3 until there are customers. See Alerts, Rules.</p>
          </section>
          <section className={card}>
            <h2 className="text-sm font-semibold">Last 30 days</h2>
            <p className="mt-1 text-sm">{o.totals.sessions30d} session{o.totals.sessions30d === 1 ? "" : "s"} · {o.totals.minutes30d} listening minutes · {o.totals.suggestions30d} suggestions · {o.totals.liveNow} open now</p>
            {o.workspaces.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No workspace has used Halyard yet.</p> : (
              <table className="mt-3 w-full text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-1 pr-3">Workspace</th><th className="pr-3">Sessions</th><th className="pr-3">Minutes</th><th className="pr-3">Suggestions</th><th className="pr-3">Open now</th><th className="pr-3">Retention</th><th>Workspace switch</th></tr></thead>
                <tbody className="divide-y divide-border">{o.workspaces.map((w) => <tr key={w.orgId}><td className="py-2 pr-3"><a className="underline" href={`/organizations/${encodeURIComponent(w.orgId)}`}>{w.orgName ?? w.orgId}</a></td><td className="pr-3">{w.sessions30d}</td><td className="pr-3">{w.minutes30d}</td><td className="pr-3">{w.suggestions30d}</td><td className="pr-3">{w.liveNow}</td><td className="pr-3">{w.retentionMonths} mo</td><td>{w.featureOverride === false ? <span className="text-[var(--danger)]">turned off</span> : w.featureOverride === true ? "turned on" : "by plan"}</td></tr>)}</tbody></table>)}
          </section>
        </div>)}
    </PageShell>
  )
}
