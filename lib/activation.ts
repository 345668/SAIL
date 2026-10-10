import { sql } from "./db"

/**
 * Activation, derived from what the platform already records (docs/architecture/37 section 12).
 * No new tracking: each step is read from the tables the product writes anyway, so it is retroactive and cannot drift
 * from the product. An organization has "completed the loop" when it has matched, drafted, sent and seen a reply.
 * Limits, stated on the page: "active" means AI, outreach or CRM activity, not page views; internal and test
 * organizations are not excluded (the founder reads the list).
 */
export const STEPS = ["profile", "matched", "drafted", "sent", "replied"] as const
export type Step = (typeof STEPS)[number]

export interface OrgActivation {
  id: string; name: string; kind: string; createdAt: string; members: number
  reached: Record<Step, boolean>
  stepsReached: number
  loopComplete: boolean
  hoursToFirstValue: number | null
  lastActive: string | null
}
/** The governed-work layer (Anker docs/architecture/37 phases 1 and 2), read from Anker's `activation_by_workspace` view: counts per workspace, never content. */
export interface AgenticLayer { authorized: number; proposalsDecided: number; agentRuns: number; workspacesAuthorized: number; workspacesDecided: number; workspacesWithAgents: number; mailSentByWorkspace: number }
export interface Activation {
  layer: AgenticLayer | null
  orgs: OrgActivation[]
  funnel: { step: Step; orgs: number }[]
  loopComplete: number
  wau: number
  mau: number
  medianHoursToFirstValue: number | null
}

const safe = async <T,>(f: () => Promise<T>, d: T): Promise<T> => { try { return await f() } catch { return d } }

export async function loadActivation(): Promise<Activation> {
  const orgs = (await sql`SELECT o.id, o.name, o.kind, o.created_at,
      (SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id) members
    FROM organizations o WHERE o.archived_at IS NULL ORDER BY o.created_at DESC LIMIT 1000`) as any[]
  // One grouped query per step, keyed by org, so the cost does not grow with the number of organizations.
  const byOrg = async (q: Promise<unknown>, key = "org_id") => new Map<string, any>(((await q) as any[]).map((r) => [r[key], r]))
  const profile = await safe(() => byOrg(sql`SELECT org_id, min(created_at) t FROM startup_profiles GROUP BY 1`), new Map())
  const matched = await safe(() => byOrg(sql`SELECT org_id, min(created_at) t FROM founder_match_runs GROUP BY 1`), new Map())
  const drafted = await safe(() => byOrg(sql`SELECT m.org_id, min(o.created_at) t FROM outreach_messages o JOIN memberships m ON m.user_id = o.user_id GROUP BY 1`), new Map())
  const sent = await safe(() => byOrg(sql`SELECT m.org_id, min(o.sent_at) t FROM outreach_messages o JOIN memberships m ON m.user_id = o.user_id WHERE o.sent_at IS NOT NULL GROUP BY 1`), new Map())
  const replied = await safe(() => byOrg(sql`SELECT m.org_id, min(r.received_at) t FROM outreach_replies r JOIN memberships m ON m.user_id = r.user_id GROUP BY 1`), new Map())
  const last = await safe(() => byOrg(sql`SELECT workspace_id AS org_id, max(created_at) t FROM ai_calls WHERE workspace_id IS NOT NULL GROUP BY 1`), new Map())

  const rows: OrgActivation[] = orgs.map((o) => {
    const reached = {
      profile: profile.has(o.id), matched: matched.has(o.id), drafted: drafted.has(o.id), sent: sent.has(o.id), replied: replied.has(o.id),
    }
    const first = matched.get(o.id)?.t
    return {
      id: o.id, name: o.name ?? "(unnamed)", kind: o.kind, createdAt: String(o.created_at), members: o.members, reached,
      stepsReached: STEPS.filter((s) => reached[s]).length,
      loopComplete: reached.matched && reached.drafted && reached.sent && reached.replied,
      hoursToFirstValue: first ? Math.max(0, (new Date(first).getTime() - new Date(o.created_at).getTime()) / 3_600_000) : null,
      lastActive: last.get(o.id)?.t ? String(last.get(o.id).t) : null,
    }
  })
  const active = async (days: number) => safe(async () => Number(((await sql`SELECT count(DISTINCT u)::int n FROM (
      SELECT actor_id u FROM ai_calls WHERE actor_id IS NOT NULL AND created_at > now() - make_interval(days => ${days})
      UNION SELECT user_id FROM outreach_messages WHERE user_id IS NOT NULL AND created_at > now() - make_interval(days => ${days})
      UNION SELECT created_by FROM crm_deals WHERE created_by IS NOT NULL AND created_at > now() - make_interval(days => ${days})) a`) as any[])[0].n), 0)
  // Mail attributed by the workspace of the contact it went to (the per-user queries above credit a person's mail to every workspace they belong to).
  const layer = await safe<AgenticLayer | null>(async () => {
    const [x] = (await sql`SELECT count(*) FILTER (WHERE first_authorization_at IS NOT NULL)::int AS authorized, coalesce(sum(proposals_decided),0)::int AS decided, coalesce(sum(agent_runs),0)::int AS runs,
        count(*) FILTER (WHERE proposals_decided > 0)::int AS ws_decided, count(*) FILTER (WHERE agent_runs > 0)::int AS ws_agents, count(*) FILTER (WHERE first_message_sent_at IS NOT NULL OR first_send_at IS NOT NULL)::int AS ws_sent
      FROM activation_by_workspace`) as any[]
    return { authorized: x.authorized, workspacesAuthorized: x.authorized, proposalsDecided: x.decided, workspacesDecided: x.ws_decided, agentRuns: x.runs, workspacesWithAgents: x.ws_agents, mailSentByWorkspace: x.ws_sent }
  }, null)
  const hrs = rows.map((r) => r.hoursToFirstValue).filter((h): h is number => h !== null).sort((a, b) => a - b)
  return {
    layer,
    orgs: rows,
    funnel: STEPS.map((step) => ({ step, orgs: rows.filter((r) => r.reached[step]).length })),
    loopComplete: rows.filter((r) => r.loopComplete).length,
    wau: await active(7), mau: await active(30),
    medianHoursToFirstValue: hrs.length ? hrs[Math.floor((hrs.length - 1) / 2)] : null,
  }
}
