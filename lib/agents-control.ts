import { sql } from "./db"
import { setFlag, listFlags, roleAtLeast, ControlError, type Role } from "./tenant-control"

/**
 * Staff view of Anker's agent runtime (Anker docs/architecture/44, 45 §1). Metadata only: counts, statuses, error text and workspace names.
 * Never a plan, an output, a proposal or a record. Pausing is a platform flag Anker checks before every step of every run.
 */
export const AGENTS = [
  { id: "pipeline_keeper", title: "Pipeline keeper" },
  { id: "weekly_brief", title: "Weekly brief" },
  { id: "reply_keeper", title: "Reply keeper" },
  { id: "outreach_drafter", title: "Outreach drafter" },
] as const
export const ALL_KEY = "agents_disabled"
export const flagKeyFor = (agentId: string | null) => (agentId === null ? ALL_KEY : `agents_disabled_${agentId}`)
const known = (id: string) => AGENTS.some((a) => a.id === id)

export interface AgentsOverview {
  paused: Record<string, { on: boolean; by: string | null; at: string | null }>
  runs: Array<{ agent_id: string; status: string; n: number }>
  workspaces: Array<{ agent_id: string; enabled: number }>
  problems: Array<{ id: string; agent_id: string; status: string; error: string | null; org_name: string | null; created_at: string }>
  evals: Array<{ suite: string; case_name: string; passed: boolean; detail: string | null; ran_at: string }>
}
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))

export async function overview(): Promise<AgentsOverview> {
  const flags = await listFlags()
  const paused: AgentsOverview["paused"] = {}
  for (const k of [null, ...AGENTS.map((a) => a.id)]) {
    const f = flags.find((x) => x.key === flagKeyFor(k))
    paused[k ?? "*"] = { on: !!f?.enabled, by: f?.updated_by ?? null, at: f ? f.updated_at : null }
  }
  const runs = ((await sql`SELECT agent_id, status, count(*)::int AS n FROM agent_executions WHERE created_at > now() - interval '7 days' GROUP BY 1, 2 ORDER BY 1, 2`) as any[]).map((r) => ({ ...r, n: Number(r.n) }))
  const workspaces = ((await sql`SELECT agent_id, count(*)::int AS enabled FROM agent_settings WHERE enabled = true GROUP BY 1`) as any[]).map((r) => ({ ...r, enabled: Number(r.enabled) }))
  const problems = ((await sql`SELECT e.id, e.agent_id, e.status, e.error, o.name AS org_name, e.created_at FROM agent_executions e LEFT JOIN organizations o ON o.id::text = e.org_id
    WHERE e.status IN ('failed','killed','budget_stopped') AND e.created_at > now() - interval '7 days' ORDER BY e.created_at DESC LIMIT 25`) as any[]).map((r) => ({ ...r, created_at: iso(r.created_at) }))
  const evals = ((await sql`SELECT DISTINCT ON (suite, case_name) suite, case_name, passed, detail, ran_at FROM eval_runs ORDER BY suite, case_name, ran_at DESC`) as any[]).map((r) => ({ ...r, ran_at: iso(r.ran_at) }))
  return { paused, runs, workspaces, problems, evals }
}

/** Pause or resume all agents (agentId null) or one. Needs an admin and a reason; audited by setFlag. */
export async function setPaused(staff: { id: string; email: string; role: Role }, agentId: string | null, paused: boolean, reason: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can pause agents.", 403)
  if (agentId !== null && !known(agentId)) throw new ControlError("Unknown agent.")
  await setFlag(staff, { key: flagKeyFor(agentId), enabled: paused, rolloutPct: 100, description: agentId === null ? "Pauses every agent for every workspace" : `Pauses the ${agentId} agent for every workspace`, reason })
}
