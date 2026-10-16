import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { listRules, MAX_MUTE_DAYS } from "@/lib/alert-rules"
import { saveRuleAction, saveQuietAction } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const f = "rounded-md border border-border bg-card px-2 py-1 text-xs"
const btn = "h-8 rounded-md border border-border px-3 text-xs"

export default async function AlertRulesPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  const { rules, quiet } = await listRules()
  return (
    <PageShell eyebrow="System" title="Alert rules" description="What Anker watches, how loudly, and when it stays quiet. Severity 1 always reaches you at once. Severity 2 is held from the quiet-hours start to its end (Berlin time) and sent in the morning digest. Severity 3 is only in the digest. A mute lasts at most 30 days and needs a reason. Precision is the share of the last 30 days' resolved incidents that someone acted on.">
      <p className="mb-4 text-sm"><Link className="underline" href="/alerts">← Alerts</Link></p>
      {err && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {!admin && <p className="mb-4 text-sm text-muted-foreground">You can read this. Changing a rule needs an admin.</p>}
      <section className={`${card} mb-4`}>
        <h2 className="text-sm font-semibold">Quiet hours</h2>
        <p className="mt-1 text-xs text-muted-foreground">Currently {String(quiet.start).padStart(2, "0")}:00 to {String(quiet.end).padStart(2, "0")}:00, Europe/Berlin.</p>
        {admin && <form action={saveQuietAction} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs">Start hour<input name="start" type="number" min={0} max={23} defaultValue={quiet.start} className={`${f} mt-1 block w-20`} /></label>
          <label className="text-xs">End hour<input name="end" type="number" min={0} max={23} defaultValue={quiet.end} className={`${f} mt-1 block w-20`} /></label>
          <label className="min-w-[200px] flex-1 text-xs">Reason<input name="reason" required minLength={MIN_REASON} maxLength={500} className={`${f} mt-1 block w-full`} /></label>
          <button className={btn}>Save</button></form>}
      </section>
      <div className="space-y-4">{rules.map((r) => (
        <section key={r.key} className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">{r.label} <code className="text-xs font-normal text-muted-foreground">{r.key}</code></h2>
            <p className="text-xs text-muted-foreground">{r.enabled ? "on" : "OFF"}{r.mutedUntil ? ` · muted until ${r.mutedUntil.slice(0, 10)} (${r.mutedReason})` : ""} · severity {r.severity ?? r.defaultSeverity}{r.severity ? " (changed)" : ""} · {r.open} open · last fired {r.lastFired ? r.lastFired.slice(0, 10) : "never"} · precision {r.precision == null ? "no data yet" : `${r.precision}% of ${r.resolved30}`}</p></div>
          <p className="mt-1 text-xs text-muted-foreground">{r.text}</p>
          {admin && <details className="mt-3"><summary className="cursor-pointer text-xs underline">Change</summary>
            <form action={saveRuleAction} className="mt-3 grid gap-2 sm:grid-cols-3"><input type="hidden" name="key" value={r.key} />
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="enabled" defaultChecked={r.enabled} /> rule is on</label>
              <label className="text-xs">Severity (blank = {r.defaultSeverity})<select name="severity" defaultValue={r.severity ?? ""} className={`${f} mt-1 block w-full`}><option value="">default</option><option value="1">1: act now</option><option value="2">2: act today</option><option value="3">3: digest only</option></select></label>
              <label className="text-xs">Mute for days (max {MAX_MUTE_DAYS})<input name="muteDays" type="number" min={1} max={MAX_MUTE_DAYS} className={`${f} mt-1 block w-full`} /></label>
              {r.key === "ai_failure_rate" && <>
                <label className="text-xs">Failure rate (0.01 to 1)<input name="rate" type="number" step="0.01" min={0.01} max={1} defaultValue={String(r.threshold.rate ?? "")} placeholder="0.2" className={`${f} mt-1 block w-full`} /></label>
                <label className="text-xs">Minimum calls<input name="minCalls" type="number" min={1} max={1000} defaultValue={String(r.threshold.minCalls ?? "")} placeholder="10" className={`${f} mt-1 block w-full`} /></label>
                <label className="text-xs">Window, minutes<input name="windowMin" type="number" min={1} max={240} defaultValue={String(r.threshold.windowMin ?? "")} placeholder="15" className={`${f} mt-1 block w-full`} /></label></>}
              {r.mutedUntil && <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="unmute" /> lift the mute now</label>}
              <label className="text-xs sm:col-span-3">Reason<input name="reason" required minLength={MIN_REASON} maxLength={500} className={`${f} mt-1 block w-full`} placeholder="e.g. Known issue, fix due Monday" /></label>
              <div className="sm:col-span-3"><button className={btn}>Save</button></div>
            </form></details>}
        </section>))}</div>
    </PageShell>
  )
}
