import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"

const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
import { saveEntitlements, setLifecycle, setFlag, loadControl, listFlags, canMove, minRoleFor, ControlError, type EntitlementInput } from "./tenant-control"

let db: PGlite
const admin = { id: "a1", email: "admin@sail.test", role: "admin" as const }
const staff = { id: "s1", email: "staff@sail.test", role: "staff" as const }
const root = { id: "r1", email: "root@sail.test", role: "superadmin" as const }
const input = (over: Partial<EntitlementInput> = {}): EntitlementInput => ({ plan: "starter", features: { linkedin: "on", outreach: "off" }, limits: { seats: "unlimited", outreach_sends_day: "75", storage_mb: "" }, expectedVersion: 0, reason: "agreed upgrade, ticket 123", ...over })
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as ControlError)

beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE organizations (id text PRIMARY KEY, name text);
    CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE workspace_access_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, org_id text, actor_user_id text, action text, target_user_id text, details jsonb, created_at timestamptz DEFAULT now());
    INSERT INTO organizations VALUES ('o1', 'Acme');`)
  await db.exec(readFileSync("db/003-tenant-control.sql", "utf8"))
}, 30000)
beforeEach(async () => { await db.exec("DELETE FROM tenant_entitlements; DELETE FROM tenant_lifecycle; DELETE FROM tenant_lifecycle_events; DELETE FROM company_audit_log; DELETE FROM workspace_access_events") })

describe("entitlements", () => {
  it("saves a plan with overrides, versions up, audits it and tells the workspace", async () => {
    expect(await saveEntitlements(admin, "o1", input())).toBe(1)
    const c = (await loadControl("o1"))!
    expect(c).toMatchObject({ plan: "starter", version: 1, features: { linkedin: true, outreach: false }, limits: { seats: null, outreach_sends_day: 75 } }); expect(c.limits).not.toHaveProperty("storage_mb")
    expect((await db.query("SELECT action FROM company_audit_log")).rows).toEqual([{ action: "tenant.entitlements.set" }])
    const ev = (await db.query("SELECT action, details FROM workspace_access_events")).rows[0] as any; expect(ev.action).toBe("staff_plan_change"); expect(ev.details.reason).toMatch(/ticket 123/)
  })
  it("needs admin, a real reason, a known plan and a number where a number is expected", async () => {
    expect((await fail(saveEntitlements(staff, "o1", input())))?.status).toBe(403)
    expect((await fail(saveEntitlements(admin, "o1", input({ reason: "short" }))))?.message).toMatch(/reason/)
    expect((await fail(saveEntitlements(admin, "o1", input({ plan: "gold" }))))?.message).toMatch(/plan/)
    expect((await fail(saveEntitlements(admin, "o1", input({ limits: { seats: "lots" } }))))?.message).toMatch(/Seats/)
    expect((await fail(saveEntitlements(admin, "nope", input())))?.status).toBe(404)
    expect((await db.query("SELECT 1 FROM tenant_entitlements")).rows.length).toBe(0)
  })
  it("a stale edit is refused instead of overwriting someone else's change", async () => {
    await saveEntitlements(admin, "o1", input())
    expect((await fail(saveEntitlements(admin, "o1", input({ expectedVersion: 0 }))))?.status).toBe(409)
    expect(await saveEntitlements(admin, "o1", input({ expectedVersion: 1, plan: "pro" }))).toBe(2)
  })
})

describe("lifecycle", () => {
  it("pauses and resumes with a recorded history, an audit and a tenant-visible entry", async () => {
    await setLifecycle(admin, "o1", "paused", "invoice unpaid after 30 days")
    expect((await loadControl("o1"))).toMatchObject({ state: "paused", stateReason: "invoice unpaid after 30 days" })
    await setLifecycle(admin, "o1", "active", "invoice paid, ticket 9")
    const c = (await loadControl("o1"))!; expect(c.state).toBe("active"); expect(c.events.map((e) => `${e.from}>${e.to}`)).toEqual(["paused>active", "active>paused"])
    expect((await db.query("SELECT action FROM workspace_access_events ORDER BY id")).rows.map((r: any) => r.action)).toEqual(["staff_lifecycle", "staff_lifecycle"])
  })
  it("who may do what: staff nothing, admin pause and resume, only a superadmin offboards", async () => {
    expect((await fail(setLifecycle(staff, "o1", "paused", "a long enough reason")))?.status).toBe(403)
    expect((await fail(setLifecycle(admin, "o1", "offboarding", "customer asked to leave")))?.status).toBe(403)
    await setLifecycle(root, "o1", "offboarding", "customer asked to leave"); expect((await loadControl("o1"))!.state).toBe("offboarding")
  })
  it("refuses a no-op, a move that is not allowed, a missing reason and an unknown workspace", async () => {
    expect((await fail(setLifecycle(admin, "o1", "active", "already active here")))?.message).toMatch(/cannot become/)
    expect((await fail(setLifecycle(admin, "o1", "paused", "x")))?.message).toMatch(/reason/)
    expect((await fail(setLifecycle(admin, "nope", "paused", "a long enough reason")))?.status).toBe(404)
    expect(canMove("offboarding", "trial")).toBe(false); expect(minRoleFor("offboarding")).toBe("superadmin")
  })
  it("a trial carries its end date", async () => {
    await setLifecycle(admin, "o1", "trial", "ten day trial for the partner", "2026-11-01")
    expect((await loadControl("o1"))!.trialEndsAt).toMatch(/^2026-11-01/)
    expect((await fail(setLifecycle(admin, "o1", "active", "converted to paid plan"))) ).toBeNull()
  })
})

describe("flags", () => {
  it("creates and updates a flag with a rollout, audited; maintenance is superadmin only", async () => {
    await setFlag(admin, { key: "new_matching", enabled: true, rolloutPct: 25, description: "v4 engine", reason: "staged rollout to a quarter" })
    expect((await listFlags()).find((f) => f.key === "new_matching")).toMatchObject({ enabled: true, rollout_pct: 25 })
    expect((await fail(setFlag(admin, { key: "maintenance", enabled: true, rolloutPct: 100, reason: "planned database work" })))?.status).toBe(403)
    await setFlag(root, { key: "maintenance", enabled: true, rolloutPct: 100, reason: "planned database work" })
    expect((await listFlags()).find((f) => f.key === "maintenance")!.enabled).toBe(true)
    expect((await db.query("SELECT count(*)::int n FROM company_audit_log WHERE action = 'platform.flag.set'")).rows[0]).toEqual({ n: 2 })
  })
  it("refuses a bad key, a bad percentage, staff and a missing reason", async () => {
    expect((await fail(setFlag(admin, { key: "Bad Key", enabled: true, rolloutPct: 10, reason: "a long enough reason" })))?.message).toMatch(/key/)
    expect((await fail(setFlag(admin, { key: "ok_key", enabled: true, rolloutPct: 150, reason: "a long enough reason" })))?.message).toMatch(/percentage/)
    expect((await fail(setFlag(staff, { key: "ok_key", enabled: true, rolloutPct: 10, reason: "a long enough reason" })))?.status).toBe(403)
    expect((await fail(setFlag(admin, { key: "ok_key", enabled: true, rolloutPct: 10, reason: "no" })))?.message).toMatch(/reason/)
  })
})
