import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { overview } from "@/lib/sending-control"
import { toggleSending, changeEnforcement } from "./actions"

export const dynamic = "force-dynamic"
const input = "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
const fmt = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
const age = (min: number | null) => (min === null ? "" : min < 90 ? `${min} min` : `${Math.round(min / 60)} h`)

export default async function SendingPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const staff = await getSession(); if (!staff) redirect("/login")
  const { err, ok } = await searchParams
  const o = await overview(); const admin = roleAtLeast(staff.role, "admin")
  return (
    <PageShell eyebrow="Platform" title="Sending" description="The outreach send executor: what workspaces have approved, what has gone, what is stuck, and a pause for the whole platform. You see counts, statuses, ages and workspace names only, never a recipient, a subject or a message.">
      {err && <p className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      <form action={toggleSending} className="grid items-end gap-3 rounded-xl border border-border card-elev p-4 md:grid-cols-[1.2fr_1.4fr_auto]">
        <input type="hidden" name="pause" value={o.paused.on ? "0" : "1"} />
        <div>
          <div className="text-sm font-medium">All outreach sending <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${o.paused.on || o.maintenance ? "bg-[var(--danger)] text-white" : "border border-border text-muted-foreground"}`}>{o.maintenance ? "Held by maintenance mode" : o.paused.on ? "Paused" : "Running"}</span></div>
          <div className="text-xs text-muted-foreground">Pausing stops the executor before its next message; approved mail waits and is not lost.{o.paused.on && o.paused.by ? ` Paused by ${o.paused.by}${o.paused.at ? `, ${fmt(o.paused.at)}` : ""}.` : ""}</div>
        </div>
        <label className="text-xs">Reason<input name="reason" required minLength={MIN_REASON} disabled={!admin} className={input} placeholder="Why this change" /></label>
        {admin && <button className="h-9 rounded-md px-4 text-sm" style={{ background: o.paused.on ? "var(--primary)" : "var(--danger)", color: "#fff" }}>{o.paused.on ? "Resume" : "Pause"}</button>}
      </form>

      <form action={changeEnforcement} className="mt-4 grid items-end gap-3 rounded-xl border border-border card-elev p-4 md:grid-cols-[1.2fr_90px_1.4fr_auto]">
        <input type="hidden" name="on" value={o.enforcement.on ? "0" : "1"} />
        <div>
          <div className="text-sm font-medium">Enforcement <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${o.enforcement.on ? "bg-[var(--primary)] text-white" : "border border-border text-muted-foreground"}`}>{o.enforcement.on ? `On for ${o.enforcement.rolloutPct}% of senders` : "Off"}</span></div>
          <div className="text-xs text-muted-foreground">When on, an outreach email with no send authorization is refused. It can be turned on only after {o.enforcement.quietDays} days with no send that skipped one.
            {o.enforcement.unauthorized.length === 0 ? ` None in the last ${o.enforcement.quietDays} days.` : ` Logged in that time: ${o.enforcement.unauthorized.map((u) => `${u.path} ${u.n} (last ${fmt(u.lastAt)})`).join(", ")}.`}</div>
        </div>
        <label className="text-xs">Share %<input name="rollout" type="number" min={0} max={100} defaultValue={o.enforcement.rolloutPct || 100} disabled={roleAtLeast(staff.role, "superadmin") === false} className={input} /></label>
        <label className="text-xs">Reason<input name="reason" required minLength={MIN_REASON} disabled={roleAtLeast(staff.role, "superadmin") === false} className={input} placeholder="Why this change" /></label>
        {roleAtLeast(staff.role, "superadmin") && <button className="h-9 rounded-md px-4 text-sm" style={{ background: o.enforcement.on ? "var(--danger)" : "var(--primary)", color: "#fff" }}>{o.enforcement.on ? "Turn off" : "Turn on"}</button>}
      </form>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border p-4"><div className="text-xs text-muted-foreground">Sent today</div><div className="text-2xl font-semibold">{o.sentToday}</div></div>
        <div className="rounded-xl border border-border p-4"><div className="text-xs text-muted-foreground">Due and waiting</div><div className="text-2xl font-semibold">{o.waiting.n}</div><div className="text-xs text-muted-foreground">{o.waiting.n ? `oldest ${age(o.waiting.oldestMinutes)}` : "nothing is waiting"}</div></div>
        <div className="rounded-xl border border-border p-4"><div className="text-xs text-muted-foreground">Active approvals</div><div className="text-2xl font-semibold">{o.activeAuthorizations}</div></div>
      </div>

      <h2 className="mt-8 mb-2 text-sm font-medium">Last 7 days by status</h2>
      {o.counts.length === 0 ? <p className="text-sm text-muted-foreground">Nothing has been approved yet.</p> : (
        <table className="w-full max-w-md text-sm"><tbody>{o.counts.map((c) => <tr key={c.status} className="border-t border-border"><td className="py-1">{c.status}</td><td className="text-right">{c.n}</td></tr>)}</tbody></table>)}

      <h2 className="mt-8 mb-2 text-sm font-medium">Needs a person</h2>
      {o.problems.length === 0 ? <p className="text-sm text-muted-foreground">No failed, unresolved or stuck sends.</p> : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">{o.problems.map((p, i) => (
          <li key={i} className="px-4 py-2">{p.org_name ?? "Unknown workspace"} · <span className="font-mono">{p.status}</span> · {p.n} item{p.n === 1 ? "" : "s"}{p.oldestHours !== null && <span className="text-muted-foreground"> · oldest {p.oldestHours} h</span>}{p.status === "unknown" && <span className="block text-xs text-muted-foreground">An interrupted send that may or may not have gone; the sender is told to check their Sent mail.</span>}</li>))}</ul>)}
    </PageShell>
  )
}
