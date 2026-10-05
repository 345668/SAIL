import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { AGENTS, overview } from "@/lib/agents-control"
import { pauseAgent } from "./actions"

export const dynamic = "force-dynamic"
const input = "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
const fmt = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const staff = await getSession(); if (!staff) redirect("/login")
  const { err, ok } = await searchParams
  const o = await overview(); const admin = roleAtLeast(staff.role, "admin")
  const rows = [{ id: "*", title: "All agents, every workspace" }, ...AGENTS.map((a) => ({ id: a.id, title: a.title }))]
  const failing = o.evals.filter((e) => !e.passed)
  return (
    <PageShell eyebrow="Platform" title="Agents" description="Pause agents for every workspace, and see how they are running. A pause takes effect before the next step of any run in progress. You see counts, statuses and error text only, never what an agent read or proposed for a workspace.">
      {err && <p className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      <div className="space-y-3">
        {rows.map((r) => {
          const p = o.paused[r.id]; const enabled = o.workspaces.find((w) => w.agent_id === r.id)?.enabled
          return (
            <form key={r.id} action={pauseAgent} className="grid items-end gap-3 rounded-xl border border-border card-elev p-4 md:grid-cols-[1.2fr_1.4fr_auto]">
              <input type="hidden" name="agent" value={r.id} /><input type="hidden" name="pause" value={p.on ? "0" : "1"} />
              <div>
                <div className="text-sm font-medium">{r.title} <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${p.on ? "bg-[var(--danger)] text-white" : "border border-border text-muted-foreground"}`}>{p.on ? "Paused" : "Running"}</span></div>
                <div className="text-xs text-muted-foreground">{enabled !== undefined ? `${enabled} workspace${enabled === 1 ? "" : "s"} have it on` : r.id === "*" ? "" : "No workspace has it on"}{p.on && p.by ? ` · paused by ${p.by}${p.at ? `, ${fmt(p.at)}` : ""}` : ""}</div>
              </div>
              <label className="text-xs">Reason<input name="reason" required minLength={MIN_REASON} disabled={!admin} className={input} placeholder="Why this change" /></label>
              {admin && <button className="h-9 rounded-md px-4 text-sm" style={{ background: p.on ? "var(--primary)" : "var(--danger)", color: "#fff" }}>{p.on ? "Resume" : "Pause"}</button>}
            </form>)
        })}
      </div>

      <h2 className="mt-10 mb-2 text-sm font-medium">Runs in the last 7 days</h2>
      {o.runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs yet.</p> : (
        <table className="w-full max-w-xl text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Agent</th><th>Status</th><th className="text-right">Runs</th></tr></thead>
          <tbody>{o.runs.map((r) => <tr key={r.agent_id + r.status} className="border-t border-border"><td className="py-1 font-mono">{r.agent_id}</td><td>{r.status}</td><td className="text-right">{r.n}</td></tr>)}</tbody></table>)}

      <h2 className="mt-8 mb-2 text-sm font-medium">Failed, stopped or over budget</h2>
      {o.problems.length === 0 ? <p className="text-sm text-muted-foreground">None in the last 7 days.</p> : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">{o.problems.map((p) => (
          <li key={p.id} className="px-4 py-2"><span className="font-mono">{p.agent_id}</span> · {p.status} · {p.org_name ?? "unknown workspace"} · <span className="text-muted-foreground">{fmt(p.created_at)}</span>{p.error && <div className="text-xs text-muted-foreground">{p.error}</div>}</li>))}</ul>)}

      <h2 className="mt-8 mb-2 text-sm font-medium">Evals (last nightly run){failing.length ? <span className="ml-2 text-[var(--danger)]">{failing.length} failing</span> : o.evals.length ? <span className="ml-2 text-muted-foreground">all passing</span> : null}</h2>
      {o.evals.length === 0 ? <p className="text-sm text-muted-foreground">No eval has run yet. They run nightly at 03:30 UTC.</p> : (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">{o.evals.map((e) => (
          <li key={e.suite + e.case_name} className="flex items-start justify-between gap-3 px-4 py-2"><span><span className={e.passed ? "text-muted-foreground" : "text-[var(--danger)]"}>{e.passed ? "Pass" : "Fail"}</span> · {e.case_name}{!e.passed && e.detail && <span className="block text-xs text-muted-foreground">{e.detail}</span>}</span><span className="shrink-0 text-xs text-muted-foreground">{fmt(e.ran_at)}</span></li>))}</ul>)}
    </PageShell>
  )
}
