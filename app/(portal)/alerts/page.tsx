import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { heartbeat, listOpen, listRecent, timeline } from "@/lib/alerts"
import { ack, noteAction, resolveAction } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const small = "rounded-md border border-border bg-card px-2 py-1 text-xs"
const btn = "h-8 rounded-md border border-border px-3 text-xs"
const SEV: Record<number, string> = { 1: "SEV 1: act now", 2: "SEV 2: act today", 3: "SEV 3: digest" }
const when = (s: string | null) => (s ? new Date(s).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—")
const age = (s: string | null) => { if (!s) return ""; const m = Math.round((Date.now() - new Date(s).getTime()) / 60000); return m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days` }

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  const [hb, open, recent] = await Promise.all([heartbeat(), listOpen(), listRecent()])
  const lines = new Map<number, Awaited<ReturnType<typeof timeline>>>()
  await Promise.all(open.map(async (i) => lines.set(i.id, await timeline(i.id))))
  return (
    <PageShell eyebrow="System" title="Alerts" description="Problems the platform found in itself, one incident each. Anker checks every five minutes, tells you by email when something opens, reminds you every four hours until you acknowledge it, and closes it by itself when it clears. Every incident says what it means and what to do.">
      {err && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      <section className={`${card} mb-4 ${hb.stale ? "border-[var(--danger)]" : ""}`} aria-live="polite">
        {hb.stale
          ? <p role="alert" className="text-sm font-medium text-[var(--danger)]">The alert evaluator has not run successfully {hb.ageMinutes == null ? "yet" : `for ${hb.ageMinutes} minutes`}. Nothing is being watched.{hb.error ? ` Last error: ${hb.error}` : ""}</p>
          : <p className="text-sm">Watching: last checked {hb.ageMinutes} min ago · {hb.rules_evaluated} rules · {open.length} open.</p>}
      </section>
      <div className="space-y-4">{open.map((i) => (
        <section key={i.id} id={`incident-${i.id}`} className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold"><span className={i.severity === 1 ? "text-[var(--danger)]" : ""}>{SEV[i.severity]}</span> · {i.rule_key}: {i.subject}</h2>
            <p className="text-xs text-muted-foreground">{i.status} · open {age(i.opened_at)} · seen {i.times_seen} times{i.acknowledged_by ? ` · acknowledged by ${i.acknowledged_by}` : ""}</p></div>
          <p className="mt-2 text-sm">{i.summary}</p>
          <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border p-3 text-xs text-muted-foreground">{i.runbook}</pre>
          <details className="mt-2"><summary className="cursor-pointer text-xs underline">Timeline ({lines.get(i.id)?.length ?? 0})</summary>
            <ul className="mt-2 space-y-1 text-xs">{(lines.get(i.id) ?? []).map((e, k) => <li key={k}>{when(e.at)} · {e.kind}{e.channel ? ` by ${e.channel}${e.ok === false ? " FAILED" : ""}` : ""}{e.actor ? ` · ${e.actor}` : ""}{e.detail ? ` · ${e.detail}` : ""}</li>)}</ul></details>
          {admin && (
            <div className="mt-3 space-y-3 border-t border-border pt-3">
              <div className="flex flex-wrap gap-2">
                {i.status === "open" && <form action={ack} className="flex flex-wrap items-center gap-2"><input type="hidden" name="id" value={i.id} /><input name="note" maxLength={500} placeholder="Note (optional)" className={`${small} w-56`} aria-label="Note" /><button className={btn}>Acknowledge</button></form>}
                <form action={noteAction} className="flex flex-wrap items-center gap-2"><input type="hidden" name="id" value={i.id} /><input name="note" required maxLength={1000} placeholder="Add a note" className={`${small} w-56`} aria-label="Note" /><button className={btn}>Add note</button></form>
              </div>
              <form action={resolveAction} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={i.id} />
                <label className="min-w-[200px] flex-1 text-xs">Cause<input name="cause" required minLength={MIN_REASON} maxLength={500} className={`${small} mt-1 block w-full`} /></label>
                <label className="min-w-[200px] flex-1 text-xs">Fix<input name="fix" required minLength={MIN_REASON} maxLength={500} className={`${small} mt-1 block w-full`} /></label>
                <button className={btn}>Resolve</button></form>
            </div>
          )}
        </section>))}
        {open.length === 0 && <section className={card}><p className="text-sm">No open incidents.</p></section>}
      </div>
      <h2 className="mb-2 mt-8 text-sm font-semibold">Recently resolved</h2>
      <section className={card}>{recent.length === 0 ? <p className="text-sm text-muted-foreground">Nothing resolved yet.</p> : (
        <ul className="space-y-2 text-xs">{recent.map((i) => <li key={i.id}><strong>{i.rule_key}: {i.subject}</strong> · SEV {i.severity} · resolved {when(i.resolved_at)} by {i.resolved_by}{i.cause ? ` · Cause: ${i.cause}` : ""}{i.fix ? ` · Fix: ${i.fix}` : ""}</li>)}</ul>
      )}</section>
    </PageShell>
  )
}
