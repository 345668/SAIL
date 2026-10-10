import { PageShell } from "@/components/page-shell"
import { loadActivation, STEPS } from "@/lib/activation"

export const dynamic = "force-dynamic"

const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—")
const hrs = (h: number | null) => (h === null ? "—" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`)
const LABEL: Record<string, string> = { profile: "Profile", matched: "Matched", drafted: "Drafted", sent: "Sent", replied: "Got a reply" }

export default async function ActivationPage() {
  let a
  try { a = await loadActivation() } catch (e: any) {
    return <PageShell eyebrow="Overview" title="Activation" description="Could not load."><p className="text-sm text-[var(--danger)]">{e?.message}</p></PageShell>
  }
  const card = "rounded-xl border border-border card-elev p-4"
  const max = Math.max(a.orgs.length, 1)
  return (
    <PageShell eyebrow="Overview" title="Activation" description="Whether workspaces get through the loop: profile, match, draft, send, reply. Read from what the product already records. Active means AI, outreach or CRM activity, not page views. Internal and test workspaces are not excluded.">
      <div className="grid gap-4 md:grid-cols-4">
        <div className={card}><div className="text-xs text-muted-foreground">Completed the loop</div><div className="mt-1 text-2xl">{a.loopComplete} <span className="text-sm text-muted-foreground">of {a.orgs.length}</span></div></div>
        <div className={card}><div className="text-xs text-muted-foreground">Weekly active users</div><div className="mt-1 text-2xl">{a.wau}</div></div>
        <div className={card}><div className="text-xs text-muted-foreground">Monthly active users</div><div className="mt-1 text-2xl">{a.mau}</div></div>
        <div className={card}><div className="text-xs text-muted-foreground">Median time to first match</div><div className="mt-1 text-2xl">{hrs(a.medianHoursToFirstValue)}</div></div>
      </div>
      {a.layer && (
        <div className={`${card} mt-4`}><div className="mb-3 text-xs text-muted-foreground">Governed work (approvals, proposals, agents): counts, never content</div>
          <div className="grid gap-4 text-sm md:grid-cols-4">
            <div><div className="text-2xl">{a.layer.workspacesAuthorized}</div><div className="text-xs text-muted-foreground">workspaces that approved a send</div></div>
            <div><div className="text-2xl">{a.layer.mailSentByWorkspace}</div><div className="text-xs text-muted-foreground">workspaces whose contacts have been emailed</div></div>
            <div><div className="text-2xl">{a.layer.proposalsDecided}</div><div className="text-xs text-muted-foreground">proposals decided, in {a.layer.workspacesDecided} workspace{a.layer.workspacesDecided === 1 ? "" : "s"}</div></div>
            <div><div className="text-2xl">{a.layer.agentRuns}</div><div className="text-xs text-muted-foreground">agent runs finished, in {a.layer.workspacesWithAgents} workspace{a.layer.workspacesWithAgents === 1 ? "" : "s"}</div></div>
          </div>
        </div>)}
      <div className={`${card} mt-4`}><div className="mb-3 text-xs text-muted-foreground">Funnel (workspaces reaching each step)</div>
        {a.funnel.map((f) => (
          <div key={f.step} className="mb-2 flex items-center gap-3 text-sm">
            <span className="w-24">{LABEL[f.step]}</span>
            <div className="h-3 flex-1 rounded bg-foreground/[0.06]"><div className="h-3 rounded" style={{ width: `${(100 * f.orgs) / max}%`, background: "var(--primary)" }} /></div>
            <span className="w-8 text-right tabular-nums">{f.orgs}</span>
          </div>))}
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-border card-elev">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2.5">Workspace</th>{STEPS.map((s) => <th key={s} className="px-2 py-2.5 text-center">{LABEL[s]}</th>)}<th className="px-4 py-2.5 text-right">To first match</th><th className="px-4 py-2.5">Last AI activity</th>
          </tr></thead>
          <tbody>
            {a.orgs.map((o) => (
              <tr key={o.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2"><a href={`/organizations/${encodeURIComponent(o.id)}`} className="font-medium hover:underline">{o.name}</a><div className="text-[11px] text-muted-foreground">{o.kind} · {o.members} member(s) · since {fmt(o.createdAt)}</div></td>
                {STEPS.map((s) => <td key={s} className="px-2 py-2 text-center">{o.reached[s] ? "●" : <span className="text-muted-foreground">·</span>}</td>)}
                <td className="px-4 py-2 text-right tabular-nums">{hrs(o.hoursToFirstValue)}</td>
                <td className="px-4 py-2 text-muted-foreground">{fmt(o.lastActive)}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </PageShell>
  )
}
