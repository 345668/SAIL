import { sql } from "./db"
import { audit } from "./audit"

/**
 * Tenant control plane (Anker docs/architecture/41): plan and overrides, lifecycle, and platform flags.
 * SAIL writes these tables in the shared database; Anker reads them (cached 30 s) and enforces them. A workspace with no row is
 * open and active, so nothing here can restrict anyone until an operator acts. Every change needs a reason, is audited, and is written to
 * the workspace's own access log so its managers can see it.
 */

export const FEATURES = [
  { key: "assistant", label: "AI assistant" }, { key: "outreach", label: "Outreach and send center" }, { key: "linkedin", label: "LinkedIn campaigns" },
  { key: "matchmaking", label: "Matchmaking" }, { key: "intake", label: "Deal intake form" }, { key: "tools", label: "Tools and conversion" },
  { key: "fund_ops", label: "Fund operations" }, { key: "spvs", label: "SPVs" },
] as const
export const LIMITS = [
  { key: "ai_spend_usd_month", label: "AI spend per month (USD)" }, { key: "seats", label: "Seats" }, { key: "outreach_sends_day", label: "Outreach sends per day" },
  { key: "intake_submissions_month", label: "Intake applications per month" }, { key: "storage_mb", label: "Storage (MB)" },
] as const
export type FeatureKey = (typeof FEATURES)[number]["key"]
export type LimitKey = (typeof LIMITS)[number]["key"]
export type Role = "staff" | "admin" | "superadmin"
export type State = "trial" | "active" | "paused" | "offboarding"
export const STATES: State[] = ["trial", "active", "paused", "offboarding"]

const MOVES: Record<State, State[]> = { trial: ["active", "paused", "offboarding"], active: ["paused", "offboarding", "trial"], paused: ["active", "offboarding"], offboarding: ["active", "paused"] }
export const canMove = (from: State, to: State) => from !== to && MOVES[from].includes(to)
const RANK: Record<Role, number> = { staff: 0, admin: 1, superadmin: 2 }
export const minRoleFor = (to: State): Role => (to === "offboarding" ? "superadmin" : "admin")
export const roleAtLeast = (have: Role, need: Role) => RANK[have] >= RANK[need]
export const MIN_REASON = 10

export class ControlError extends Error { constructor(message: string, readonly status = 400) { super(message) } }
type Staff = { id: string; email: string; role: Role }
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const obj = (v: unknown): any => (typeof v === "string" ? (() => { try { return JSON.parse(v) } catch { return {} } })() : v ?? {})
const needReason = (r: string) => { const t = r.trim(); if (t.length < MIN_REASON) throw new ControlError(`A reason of at least ${MIN_REASON} characters is required.`); return t.slice(0, 500) }

export interface Control {
  org: { id: string; name: string }
  plans: { plan: string; label: string; features: Record<string, boolean>; limits: Record<string, number | null> }[]
  plan: string | null
  features: Record<string, boolean>
  limits: Record<string, number | null>
  notes: string | null
  version: number
  state: State
  stateReason: string | null
  trialEndsAt: string | null
  stateChangedAt: string | null
  events: { at: string; from: string | null; to: string; reason: string | null; actor: string | null }[]
}

export async function loadControl(orgId: string): Promise<Control | null> {
  const org = ((await sql`SELECT id, name FROM organizations WHERE id = ${orgId}`) as any[])[0]
  if (!org) return null
  const ent = ((await sql`SELECT * FROM tenant_entitlements WHERE org_id = ${orgId}`) as any[])[0]
  const life = ((await sql`SELECT * FROM tenant_lifecycle WHERE org_id = ${orgId}`) as any[])[0]
  const plans = (await sql`SELECT plan, label, features, limits FROM plan_catalog ORDER BY sort`) as any[]
  const events = (await sql`SELECT at, from_state, to_state, reason, actor FROM tenant_lifecycle_events WHERE org_id = ${orgId} ORDER BY id DESC LIMIT 20`) as any[]
  return {
    org: { id: org.id, name: org.name ?? "(unnamed)" },
    plans: plans.map((p) => ({ plan: p.plan, label: p.label, features: obj(p.features), limits: obj(p.limits) })),
    plan: ent?.plan ?? null, features: obj(ent?.features), limits: obj(ent?.limits), notes: ent?.notes ?? null, version: ent ? Number(ent.version) : 0,
    state: (life?.state ?? "active") as State, stateReason: life?.reason ?? null, trialEndsAt: life?.trial_ends_at ? iso(life.trial_ends_at) : null, stateChangedAt: life?.changed_at ? iso(life.changed_at) : null,
    events: events.map((e) => ({ at: iso(e.at), from: e.from_state ?? null, to: e.to_state, reason: e.reason ?? null, actor: e.actor ?? null })),
  }
}

/** Tell the workspace's own managers that staff changed something about it (the same log their team page reads). */
async function tellTenant(orgId: string, staff: Staff, action: string, details: Record<string, unknown>): Promise<void> {
  try {
    await sql`INSERT INTO workspace_access_events (org_id, actor_user_id, action, details) VALUES (${orgId}, ${"staff:" + staff.id}, ${action}, ${JSON.stringify(details)}::jsonb)`
  } catch (e) { console.error("[tenant-control] tenant-visible log failed", (e as Error).message) }
}

export interface EntitlementInput {
  plan: string | null
  /** For each feature: "plan" (follow the plan), "on" or "off". */
  features: Record<string, "plan" | "on" | "off">
  /** For each limit: "" (follow the plan), "unlimited", or a number. */
  limits: Record<string, string>
  notes?: string
  expectedVersion: number
  reason: string
}

export async function saveEntitlements(staff: Staff, orgId: string, input: EntitlementInput): Promise<number> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change a workspace's plan.", 403)
  const reason = needReason(input.reason)
  if (!((await sql`SELECT 1 FROM organizations WHERE id = ${orgId}`) as any[]).length) throw new ControlError("Unknown workspace.", 404)
  if (input.plan && !((await sql`SELECT 1 FROM plan_catalog WHERE plan = ${input.plan}`) as any[]).length) throw new ControlError("Unknown plan.")
  const features: Record<string, boolean> = {}
  for (const f of FEATURES) { const v = input.features[f.key]; if (v === "on") features[f.key] = true; else if (v === "off") features[f.key] = false }
  const limits: Record<string, number | null> = {}
  for (const l of LIMITS) {
    const v = String(input.limits[l.key] ?? "").trim().toLowerCase()
    if (v === "") continue
    if (v === "unlimited") { limits[l.key] = null; continue }
    const n = Number(v.replace(/,/g, ""))
    if (!Number.isFinite(n) || n < 0) throw new ControlError(`${l.label}: enter a number, "unlimited", or leave blank to follow the plan.`)
    limits[l.key] = n
  }
  const before = ((await sql`SELECT version, plan FROM tenant_entitlements WHERE org_id = ${orgId}`) as any[])[0]
  if ((before ? Number(before.version) : 0) !== input.expectedVersion) throw new ControlError("This workspace was changed by someone else. Reload and try again.", 409)
  const rows = (await sql`
    INSERT INTO tenant_entitlements (org_id, plan, features, limits, notes, version, updated_by)
    VALUES (${orgId}, ${input.plan}, ${JSON.stringify(features)}::jsonb, ${JSON.stringify(limits)}::jsonb, ${input.notes?.slice(0, 500) ?? null}, 1, ${staff.email})
    ON CONFLICT (org_id) DO UPDATE SET plan = EXCLUDED.plan, features = EXCLUDED.features, limits = EXCLUDED.limits, notes = EXCLUDED.notes,
      version = tenant_entitlements.version + 1, updated_by = EXCLUDED.updated_by, updated_at = now()
    WHERE tenant_entitlements.version = ${input.expectedVersion}
    RETURNING version`) as any[]
  if (!rows.length) throw new ControlError("This workspace was changed by someone else. Reload and try again.", 409)
  await audit("tenant.entitlements.set", staff, orgId, { plan: input.plan, features, limits, reason, version: rows[0].version })
  await tellTenant(orgId, staff, "staff_plan_change", { plan: input.plan, reason })
  return Number(rows[0].version)
}

export async function setLifecycle(staff: Staff, orgId: string, to: State, reason: string, trialEndsAt?: string | null): Promise<void> {
  if (!STATES.includes(to)) throw new ControlError("Unknown state.")
  if (!roleAtLeast(staff.role, minRoleFor(to))) throw new ControlError(to === "offboarding" ? "Only a superadmin can start offboarding." : "Only admins can change a workspace's state.", 403)
  const why = needReason(reason)
  const org = ((await sql`SELECT id FROM organizations WHERE id = ${orgId}`) as any[])[0]
  if (!org) throw new ControlError("Unknown workspace.", 404)
  const cur = ((await sql`SELECT state FROM tenant_lifecycle WHERE org_id = ${orgId}`) as any[])[0]
  const from = (cur?.state ?? "active") as State
  if (!canMove(from, to)) throw new ControlError(`A ${from} workspace cannot become ${to}.`)
  const trial = to === "trial" && trialEndsAt ? new Date(trialEndsAt) : null
  if (trial && Number.isNaN(trial.getTime())) throw new ControlError("Enter a valid trial end date.")
  await sql`INSERT INTO tenant_lifecycle (org_id, state, reason, trial_ends_at, changed_by, changed_at)
    VALUES (${orgId}, ${to}, ${why}, ${trial ? trial.toISOString() : null}, ${staff.email}, now())
    ON CONFLICT (org_id) DO UPDATE SET state = EXCLUDED.state, reason = EXCLUDED.reason, trial_ends_at = EXCLUDED.trial_ends_at, changed_by = EXCLUDED.changed_by, changed_at = now()`
  await sql`INSERT INTO tenant_lifecycle_events (org_id, from_state, to_state, reason, actor) VALUES (${orgId}, ${from}, ${to}, ${why}, ${staff.email})`
  await audit("tenant.lifecycle.set", staff, orgId, { from, to, reason: why })
  await tellTenant(orgId, staff, "staff_lifecycle", { from, to, reason: why })
}

// ── platform flags ──────────────────────────────────────────────────────

export interface Flag { key: string; enabled: boolean; rollout_pct: number; description: string | null; updated_by: string | null; updated_at: string }
export async function listFlags(): Promise<Flag[]> {
  return ((await sql`SELECT key, enabled, rollout_pct, description, updated_by, updated_at FROM platform_flags ORDER BY key`) as any[]).map((r) => ({ ...r, rollout_pct: Number(r.rollout_pct), updated_at: iso(r.updated_at) }))
}

export async function setFlag(staff: Staff, input: { key: string; enabled: boolean; rolloutPct: number; description?: string; reason: string }): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change flags.", 403)
  const reason = needReason(input.reason)
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(input.key)) throw new ControlError("A flag key is lowercase letters, numbers and underscores.")
  const pct = Math.round(input.rolloutPct)
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ControlError("Rollout is a percentage from 0 to 100.")
  // Switching maintenance mode on stops AI runs and sending for everyone, so it is a superadmin decision.
  if (input.key === "maintenance" && !roleAtLeast(staff.role, "superadmin")) throw new ControlError("Only a superadmin can change maintenance mode.", 403)
  await sql`INSERT INTO platform_flags (key, enabled, rollout_pct, description, updated_by) VALUES (${input.key}, ${input.enabled}, ${pct}, ${input.description?.slice(0, 200) ?? null}, ${staff.email})
    ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, rollout_pct = EXCLUDED.rollout_pct, description = COALESCE(EXCLUDED.description, platform_flags.description), updated_by = EXCLUDED.updated_by, updated_at = now()`
  await audit("platform.flag.set", staff, input.key, { enabled: input.enabled, rolloutPct: pct, reason })
}
