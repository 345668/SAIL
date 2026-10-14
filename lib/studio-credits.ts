import { sql } from "./db"
import { audit } from "./audit"
import { ControlError, MIN_REASON, roleAtLeast, tellTenant } from "./tenant-control"

/**
 * Media Studio credits, the operator side (Anker docs/architecture/52). A workspace has a daily allowance (its own override, else its plan, else 1,000)
 * and a bonus balance operators can add to and take back. Everything here writes the shared ledger Anker charges against. Every change needs a
 * reason, is audited, and is written to the workspace's own access log.
 */
export const DEFAULT_DAILY_CREDITS = 1000
export const MAX_GRANT = 100_000
/** A grant above this needs a superadmin. */
export const ADMIN_GRANT_CEILING = 20_000
export type Staff = { id: string; email: string; role: "staff" | "admin" | "superadmin" }

const scopeOf = (orgId: string) => `org:${orgId}`
const reasonOf = (r: string) => {
  const t = (r ?? "").trim()
  if (t.length < MIN_REASON) throw new ControlError(`A reason of at least ${MIN_REASON} characters is required.`)
  return t.slice(0, 500)
}
const whole = (n: unknown, what: string) => {
  const v = Number(n)
  if (!Number.isInteger(v) || v < 1) throw new ControlError(`${what}: enter a whole number of credits, 1 or more.`)
  return v
}

export interface CreditsPanel {
  org: { id: string; name: string }
  /** Daily allowance, null when unlimited. */
  allowance: number | null
  source: "override" | "plan" | "default"
  plan: string | null
  usedToday: number
  bonus: number
  week: { day: string; spent: number }[]
  ledger: { at: string; kind: string; credits: number; source: string; job: string | null; reason: string | null; actor: string | null }[]
  jobs7d: number
}

export async function loadCredits(orgId: string): Promise<CreditsPanel | null> {
  const org = ((await sql`SELECT id, name FROM organizations WHERE id = ${orgId}`) as any[])[0]
  if (!org) return null
  const ent = ((await sql`SELECT plan, limits FROM tenant_entitlements WHERE org_id = ${orgId}`) as any[])[0]
  const planRow = ent?.plan ? ((await sql`SELECT limits FROM plan_catalog WHERE plan = ${ent.plan}`) as any[])[0] : null
  const lim = (o: any): unknown => { const l = typeof o === "string" ? JSON.parse(o) : o ?? {}; return l.ai_studio_daily_credits }
  const own = ent ? lim(ent.limits) : undefined
  const planned = planRow ? lim(planRow.limits) : undefined
  let allowance: number | null = DEFAULT_DAILY_CREDITS, source: CreditsPanel["source"] = "default"
  const pick = (v: unknown) => (typeof v === "number" ? (v < 0 ? null : Math.floor(v)) : undefined)
  if (pick(own) !== undefined) { allowance = pick(own) as number | null; source = "override" }
  else if (pick(planned) !== undefined) { allowance = pick(planned) as number | null; source = "plan" }
  const scope = scopeOf(orgId)
  const used = ((await sql`SELECT COALESCE(-sum(credits), 0)::int AS n FROM ai_studio_credit_ledger WHERE scope_key = ${scope} AND source = 'daily' AND day = (now() AT TIME ZONE 'UTC')::date`) as any[])[0]
  const bonus = ((await sql`SELECT GREATEST(0, COALESCE(sum(credits), 0))::int AS n FROM ai_studio_credit_ledger WHERE scope_key = ${scope} AND source = 'bonus'`) as any[])[0]
  const week = (await sql`SELECT d::date::text AS day, COALESCE(-sum(l.credits) FILTER (WHERE l.kind IN ('spend','refund')), 0)::int AS spent
      FROM generate_series((now() AT TIME ZONE 'UTC')::date - 6, (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
      LEFT JOIN ai_studio_credit_ledger l ON l.scope_key = ${scope} AND ((l.source = 'daily' AND l.day = d::date) OR (l.source = 'bonus' AND (l.created_at AT TIME ZONE 'UTC')::date = d::date))
     GROUP BY d ORDER BY d`) as any[]
  const ledger = (await sql`SELECT created_at, kind, credits, source, job_id, reason, actor FROM ai_studio_credit_ledger WHERE scope_key = ${scope} ORDER BY id DESC LIMIT 40`) as any[]
  const jobs = ((await sql`SELECT count(*)::int AS n FROM ai_studio_jobs WHERE scope_key = ${scope} AND created_at > now() - interval '7 days'`) as any[])[0]
  return {
    org: { id: org.id, name: org.name ?? "(unnamed)" }, allowance, source, plan: ent?.plan ?? null,
    usedToday: Number(used.n), bonus: Number(bonus.n),
    week: week.map((w) => ({ day: w.day, spent: Number(w.spent) })),
    ledger: ledger.map((r) => ({ at: new Date(r.created_at).toISOString(), kind: r.kind, credits: Number(r.credits), source: r.source, job: r.job_id ?? null, reason: r.reason ?? null, actor: r.actor ?? null })),
    jobs7d: Number(jobs.n),
  }
}

async function assertWorkspace(orgId: string) {
  if (!((await sql`SELECT 1 FROM organizations WHERE id = ${orgId}`) as any[]).length) throw new ControlError("Unknown workspace.", 404)
}

/** Adds bonus credits (a reward, a goodwill gesture, a trial extension). They are spent after the day's allowance and do not reset. */
export async function grantCredits(staff: Staff, orgId: string, input: { credits: number; reason: string }): Promise<number> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can grant credits.", 403)
  const n = whole(input.credits, "Credits")
  if (n > MAX_GRANT) throw new ControlError(`A grant is at most ${MAX_GRANT.toLocaleString("en")} credits.`)
  if (n > ADMIN_GRANT_CEILING && !roleAtLeast(staff.role, "superadmin")) throw new ControlError(`Grants above ${ADMIN_GRANT_CEILING.toLocaleString("en")} credits need a superadmin.`, 403)
  const reason = reasonOf(input.reason)
  await assertWorkspace(orgId)
  await sql`INSERT INTO ai_studio_credit_ledger (scope_key, org_id, kind, credits, source, reason, actor) VALUES (${scopeOf(orgId)}, ${orgId}, 'grant', ${n}, 'bonus', ${reason}, ${staff.email})`
  await audit("tenant.studio_credits.grant", staff, orgId, { credits: n, reason })
  await tellTenant(orgId, staff, "staff_studio_credits_granted", { credits: n, reason })
  return n
}

/** Takes back unspent bonus credits. It cannot take more than the balance. */
export async function revokeCredits(staff: Staff, orgId: string, input: { credits: number; reason: string }): Promise<number> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can take back credits.", 403)
  const n = whole(input.credits, "Credits")
  const reason = reasonOf(input.reason)
  await assertWorkspace(orgId)
  const have = Number(((await sql`SELECT GREATEST(0, COALESCE(sum(credits), 0))::int AS n FROM ai_studio_credit_ledger WHERE scope_key = ${scopeOf(orgId)} AND source = 'bonus'`) as any[])[0].n)
  if (n > have) throw new ControlError(`Only ${have.toLocaleString("en")} bonus credits are unspent, so that many at most can be taken back.`)
  await sql`INSERT INTO ai_studio_credit_ledger (scope_key, org_id, kind, credits, source, reason, actor) VALUES (${scopeOf(orgId)}, ${orgId}, 'revoke', ${-n}, 'bonus', ${reason}, ${staff.email})`
  await audit("tenant.studio_credits.revoke", staff, orgId, { credits: n, reason })
  await tellTenant(orgId, staff, "staff_studio_credits_revoked", { credits: n, reason })
  return n
}

// ── the price list ───────────────────────────────────────────────────────
export interface RateRow { model: string; resolution: string; unit: "job" | "second"; credits: number; active: boolean; updatedAt: string }
export async function listRates(): Promise<RateRow[]> {
  return ((await sql`SELECT model, resolution, unit, credits, active, updated_at FROM ai_studio_credit_rates ORDER BY model, resolution`) as any[]).map((r) => ({ model: r.model, resolution: r.resolution, unit: r.unit, credits: Number(r.credits), active: !!r.active, updatedAt: new Date(r.updated_at).toISOString() }))
}
/** Changes what one model costs. Anker reads the table at most once a minute. A rate is never zero; turning one off makes the model unavailable to generate. */
export async function saveRate(staff: Staff, input: { model: string; resolution: string; credits: number; active: boolean; reason: string }): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change the price list.", 403)
  const credits = whole(input.credits, "Credits")
  if (credits > 100_000) throw new ControlError("A single price above 100,000 credits is not accepted.")
  const reason = reasonOf(input.reason)
  const before = ((await sql`SELECT credits, active FROM ai_studio_credit_rates WHERE model = ${input.model} AND resolution = ${input.resolution}`) as any[])[0]
  if (!before) throw new ControlError("Unknown price.", 404)
  await sql`UPDATE ai_studio_credit_rates SET credits = ${credits}, active = ${!!input.active}, updated_at = now() WHERE model = ${input.model} AND resolution = ${input.resolution}`
  await audit("platform.studio_rate.set", staff, `${input.model}|${input.resolution}`, { from: { credits: Number(before.credits), active: !!before.active }, to: { credits, active: !!input.active }, reason })
}
