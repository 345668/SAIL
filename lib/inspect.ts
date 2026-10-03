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
  const last = ai.map((r) => r.last).filter(Boolean).sort().pop() ?? null
  return {
    org: { id: o[0].id, name: o[0].name ?? "(unnamed)", kind: o[0].kind, createdAt: String(o[0].created_at), archivedAt: o[0].archived_at ? String(o[0].archived_at) : null },
    members: members.map((m) => ({ role: m.org_role, persona: m.persona, count: m.n })),
    billing: b.length ? { status: b[0].status, plan: b[0].plan, periodEnd: b[0].current_period_end ? String(b[0].current_period_end) : null } : null,
    ai: {
      calls30d: ai.reduce((s, r) => s + r.calls, 0), failed30d: ai.reduce((s, r) => s + r.failed, 0), cost30d: ai.reduce((s, r) => s + r.cost, 0),
      byTask: ai.map((r) => ({ task: r.task, calls: r.calls, failed: r.failed, cost: r.cost })),
    },
    counts,
    lastActivity: last ? String(last) : null,
  }
}
