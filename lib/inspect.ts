import { sql, query } from "./db"

/** Metadata-only tenant inspection. Staff never see a tenant's private records (deals, notes,
 *  contacts, messages): only plan, usage, errors and counts. Access needs a reason, lasts
 *  15 minutes, is audited, and is written to workspace_access_events so the tenant's own
 *  managers can see that staff looked, when, and why. */
export const INSPECT_WINDOW_MS = 15 * 60_000
export const MIN_REASON = 10

export async function startInspection(staff: { id: string; email: string }, orgId: string, reason: string): Promise<number> {
  const why = reason.trim().slice(0, 500)
  if (why.length < MIN_REASON) throw new Error(`Reason must be at least ${MIN_REASON} characters`)
  const org = (await sql`SELECT id FROM organizations WHERE id = ${orgId}`) as any[]
  if (!org.length) throw new Error("Unknown organization")
  const rows = (await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
    VALUES (${staff.id}, ${staff.email}, 'tenant.inspect.start', ${orgId}, ${JSON.stringify({ reason: why, windowMin: 15 })}::jsonb)
    RETURNING id`) as any[]
  try {
    await sql`INSERT INTO workspace_access_events (org_id, actor_user_id, action, details)
      VALUES (${orgId}, ${"staff:" + staff.id}, 'staff_inspect', ${JSON.stringify({ reason: why, scope: "metadata-only" })}::jsonb)`
  } catch (e) {
    console.error("[inspect] tenant-visible log failed", (e as Error).message)
  }
  return Number(rows[0].id)
}

/** The inspection must be this staff member's, for this org, and still inside its window. */
export async function validInspection(staffId: string, orgId: string, id: number): Promise<{ reason: string; expiresAt: Date } | null> {
  if (!Number.isFinite(id)) return null
  const r = (await sql`SELECT detail, created_at FROM company_audit_log
    WHERE id = ${id} AND action = 'tenant.inspect.start' AND staff_id = ${staffId} AND target = ${orgId}`) as any[]
  if (!r.length) return null
  const expiresAt = new Date(new Date(r[0].created_at).getTime() + INSPECT_WINDOW_MS)
  if (expiresAt.getTime() < Date.now()) return null
  return { reason: String(r[0].detail?.reason ?? ""), expiresAt }
}

export interface TenantSummary {
  org: { id: string; name: string; kind: string; createdAt: string; archivedAt: string | null }
  members: { role: string; persona: string | null; count: number }[]
  billing: { status: string; plan: string | null; periodEnd: string | null } | null
  ai: { calls30d: number; failed30d: number; cost30d: number; byTask: { task: string; calls: number; failed: number; cost: number }[] }
  counts: { label: string; n: number }[]
  lastActivity: string | null
  daily: { day: string; calls: number; failed: number }[]
  errors: { status: string; n: number }[]
  outreach: { sent: number; bounced: number; complained: number; replies: number }
  agentRuns: { runs: number; errored: number }
  storage: { files: number; bytes: number }
  mailboxes: { status: string; n: number }[]
  health: { score: number; label: "healthy" | "watch" | "at risk"; reasons: string[] }
  inspections: { at: string; by: string; reason: string }[]
}

/** A transparent, rule-based score, not a model: start at 100, subtract for each visible problem and say why. */
export function healthOf(x: { billing: TenantSummary["billing"]; ai: TenantSummary["ai"]; lastActivity: string | null; outreach: TenantSummary["outreach"]; mailboxes: TenantSummary["mailboxes"]; now?: number }) {
  const reasons: string[] = []; let score = 100
  const now = x.now ?? Date.now()
  if (x.billing && ["past_due", "unpaid", "canceled", "incomplete_expired"].includes(x.billing.status)) { score -= 30; reasons.push(`Billing is ${x.billing.status}`) }
  if (x.ai.calls30d >= 10 && x.ai.failed30d / x.ai.calls30d > 0.2) { score -= 25; reasons.push(`${Math.round((100 * x.ai.failed30d) / x.ai.calls30d)}% of AI calls failed in 30 days`) }
  const idleDays = x.lastActivity ? (now - new Date(x.lastActivity).getTime()) / 86_400_000 : Infinity
  if (idleDays > 14) { score -= 20; reasons.push(x.lastActivity ? `No AI activity for ${Math.floor(idleDays)} days` : "No AI activity recorded") }
  if (x.outreach.sent >= 20 && x.outreach.bounced / x.outreach.sent > 0.05) { score -= 15; reasons.push("Bounce rate above 5%") }
  if (x.outreach.complained > 0) { score -= 15; reasons.push(`${x.outreach.complained} spam complaint(s)`) }
  if (x.mailboxes.some((m) => m.status !== "active" && m.status !== "connected")) { score -= 10; reasons.push("A connected mailbox is in an error state") }
  score = Math.max(0, score)
  return { score, label: (score >= 75 ? "healthy" : score >= 50 ? "watch" : "at risk") as "healthy" | "watch" | "at risk", reasons }
}

const COUNT_TABLES: [string, string][] = [
  ["crm_deals", "CRM deals"], ["crm_people", "CRM people"], ["crm_companies", "CRM companies"],
  ["crm_tasks", "Tasks"], ["investor_calls", "Calls"], ["investor_updates", "Investor updates"],
  ["workspace_decks", "Decks"], ["founder_match_runs", "Match runs"],
]

export async function tenantSummary(orgId: string): Promise<TenantSummary | null> {
  const o = (await sql`SELECT id, name, kind, created_at, archived_at FROM organizations WHERE id = ${orgId}`) as any[]
  if (!o.length) return null
  const members = (await sql`SELECT org_role, persona, count(*)::int n FROM memberships WHERE org_id = ${orgId} GROUP BY 1,2 ORDER BY 3 DESC`) as any[]
  const b = (await sql`SELECT status, plan, current_period_end FROM billing_subscriptions WHERE org_id = ${orgId} ORDER BY updated_at DESC LIMIT 1`) as any[]
  const ai = (await sql`SELECT task, count(*)::int calls, count(*) FILTER (WHERE NOT ok)::int failed, COALESCE(sum(cost_usd),0)::float cost, max(created_at) last
    FROM ai_calls WHERE workspace_id = ${orgId} AND created_at > now() - interval '30 days' GROUP BY task ORDER BY 2 DESC`) as any[]
  const counts: { label: string; n: number }[] = []
  for (const [t, label] of COUNT_TABLES) {
    try {
      const r = (await query(`SELECT count(*)::int n FROM ${t} WHERE org_id = $1`, [orgId])) as any[]
      counts.push({ label, n: Number(r[0].n) })
    } catch { /* table absent in this environment: omit */ }
  }
  const daily = (await sql`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') d, count(*)::int calls, count(*) FILTER (WHERE NOT ok)::int failed
    FROM ai_calls WHERE workspace_id = ${orgId} AND created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`) as any[]
  const errors = (await sql`SELECT COALESCE(http_status::text, 'no status') s, count(*)::int n FROM ai_calls
    WHERE workspace_id = ${orgId} AND NOT ok AND created_at > now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`) as any[]
  const safe = async <T,>(f: () => Promise<T>, d: T): Promise<T> => { try { return await f() } catch { return d } }
  const o30 = await safe(async () => ((await sql`SELECT count(*) FILTER (WHERE m.status = 'sent' OR m.sent_at IS NOT NULL)::int sent, count(*) FILTER (WHERE m.bounced_at IS NOT NULL)::int bounced,
      count(*) FILTER (WHERE m.complained_at IS NOT NULL)::int complained
    FROM outreach_messages m WHERE m.user_id IN (SELECT user_id FROM memberships WHERE org_id = ${orgId}) AND m.created_at > now() - interval '30 days'`) as any[])[0], { sent: 0, bounced: 0, complained: 0 })
  const replies = await safe(async () => Number(((await sql`SELECT count(*)::int n FROM outreach_replies r WHERE r.user_id IN (SELECT user_id FROM memberships WHERE org_id = ${orgId}) AND r.created_at > now() - interval '30 days'`) as any[])[0].n), 0)
  const runs = await safe(async () => ((await sql`SELECT count(*)::int runs, count(*) FILTER (WHERE error IS NOT NULL)::int errored FROM agent_runs
    WHERE user_id IN (SELECT user_id FROM memberships WHERE org_id = ${orgId}) AND started_at > now() - interval '30 days'`) as any[])[0], { runs: 0, errored: 0 })
  const stor = await safe(async () => ((await sql`SELECT count(*)::int files, COALESCE(sum(file_size),0)::float bytes FROM data_room_files
    WHERE user_id IN (SELECT user_id FROM memberships WHERE org_id = ${orgId})`) as any[])[0], { files: 0, bytes: 0 })
  const mail = await safe(async () => (await sql`SELECT COALESCE(status,'unknown') status, count(*)::int n FROM email_oauth_accounts
    WHERE user_id IN (SELECT user_id FROM memberships WHERE org_id = ${orgId}) GROUP BY 1`) as any[], [])
  const insp = await safe(async () => (await sql`SELECT created_at, staff_email, detail FROM company_audit_log
    WHERE action = 'tenant.inspect.start' AND target = ${orgId} ORDER BY id DESC LIMIT 20`) as any[], [])
  const last = ai.map((r) => r.last).filter(Boolean).sort().pop() ?? null
  const billing = b.length ? { status: b[0].status, plan: b[0].plan, periodEnd: b[0].current_period_end ? String(b[0].current_period_end) : null } : null
  const aiOut = {
    calls30d: ai.reduce((s, r) => s + r.calls, 0), failed30d: ai.reduce((s, r) => s + r.failed, 0), cost30d: ai.reduce((s, r) => s + r.cost, 0),
    byTask: ai.map((r) => ({ task: r.task, calls: r.calls, failed: r.failed, cost: r.cost })),
  }
  const outreach = { sent: Number(o30.sent), bounced: Number(o30.bounced), complained: Number(o30.complained), replies }
  const mailboxes = mail.map((m) => ({ status: m.status, n: m.n }))
  const lastActivity = last ? String(last) : null
  return {
    org: { id: o[0].id, name: o[0].name ?? "(unnamed)", kind: o[0].kind, createdAt: String(o[0].created_at), archivedAt: o[0].archived_at ? String(o[0].archived_at) : null },
    members: members.map((m) => ({ role: m.org_role, persona: m.persona, count: m.n })),
    billing, ai: aiOut, counts, lastActivity,
    daily: daily.map((d) => ({ day: d.d, calls: d.calls, failed: d.failed })),
    errors: errors.map((e) => ({ status: e.s, n: e.n })),
    outreach, agentRuns: { runs: Number(runs.runs), errored: Number(runs.errored) },
    storage: { files: Number(stor.files), bytes: Number(stor.bytes) },
    mailboxes,
    health: healthOf({ billing, ai: aiOut, lastActivity, outreach, mailboxes }),
    inspections: insp.map((r) => ({ at: String(r.created_at), by: r.staff_email ?? "staff", reason: String(r.detail?.reason ?? "") })),
  }
}
