import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"

const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
import { grantCredits, revokeCredits, loadCredits, listRates, saveRate, ADMIN_GRANT_CEILING, MAX_GRANT } from "./studio-credits"
import { saveEntitlements, loadControl, ControlError } from "./tenant-control"

let db: PGlite
const admin = { id: "a1", email: "admin@sail.test", role: "admin" as const }
const staff = { id: "s1", email: "staff@sail.test", role: "staff" as const }
const root = { id: "r1", email: "root@sail.test", role: "superadmin" as const }
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as ControlError)
const why = "Partner reward for the pilot, ticket 77"
const bonus = async () => Number(((await db.query("SELECT GREATEST(0, COALESCE(sum(credits),0))::int n FROM ai_studio_credit_ledger WHERE scope_key='org:o1' AND source='bonus'")).rows[0] as any).n)

beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE organizations (id text PRIMARY KEY, name text);
    CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE workspace_access_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, org_id text, actor_user_id text, action text, target_user_id text, details jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE ai_studio_jobs (id text PRIMARY KEY, scope_key text, created_at timestamptz DEFAULT now());
    CREATE TABLE ai_studio_credit_rates (model text NOT NULL, resolution text NOT NULL DEFAULT '*', unit text NOT NULL, credits integer NOT NULL, active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (model, resolution));
    CREATE TABLE ai_studio_credit_ledger (id bigserial PRIMARY KEY, scope_key text NOT NULL, org_id text, user_id text, job_id text, kind text NOT NULL, credits integer NOT NULL, source text NOT NULL, day date, reason text, actor text, created_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO organizations VALUES ('o1', 'Acme'), ('o2', 'Other');
    INSERT INTO ai_studio_credit_rates VALUES ('qwen-image-2.0', '*', 'job', 30), ('wan2.7', '720p', 'second', 50);`)
  await db.exec(readFileSync("db/003-tenant-control.sql", "utf8"))
  await db.exec(readFileSync("db/004-plan-catalogue.sql", "utf8"))
  await db.exec(`UPDATE plan_catalog SET limits = jsonb_set(limits, '{ai_studio_daily_credits}', '6000') WHERE plan = 'fund_pro'; UPDATE plan_catalog SET limits = jsonb_set(limits, '{ai_studio_daily_credits}', '-1') WHERE plan = 'design_partner'`)
}, 30000)
beforeEach(() => db.exec("DELETE FROM ai_studio_credit_ledger; DELETE FROM ai_studio_jobs; DELETE FROM tenant_entitlements; DELETE FROM company_audit_log; DELETE FROM workspace_access_events; UPDATE ai_studio_credit_rates SET credits = 30, active = true WHERE model = 'qwen-image-2.0'"))

describe("what a workspace has", () => {
  it("defaults to 1,000 a day when no plan or override says otherwise", async () => {
    expect(await loadCredits("o1")).toMatchObject({ allowance: 1000, source: "default", plan: null, usedToday: 0, bonus: 0 })
    expect(await loadCredits("nope")).toBeNull()
  })
  it("takes the plan's allowance, an override over it, and -1 as unlimited", async () => {
    await db.query("INSERT INTO tenant_entitlements (org_id, plan) VALUES ('o1', 'fund_pro')")
    expect(await loadCredits("o1")).toMatchObject({ allowance: 6000, source: "plan", plan: "fund_pro" })
    await db.query("UPDATE tenant_entitlements SET limits = '{\"ai_studio_daily_credits\": 2500}'")
    expect(await loadCredits("o1")).toMatchObject({ allowance: 2500, source: "override" })
    await db.query("UPDATE tenant_entitlements SET limits = '{}', plan = 'design_partner'")
    expect(await loadCredits("o1")).toMatchObject({ allowance: null, source: "plan" })
  })
  it("shows today's spending, the bonus balance, the week and the ledger", async () => {
    await db.query("INSERT INTO ai_studio_credit_ledger(scope_key,org_id,job_id,kind,credits,source,day) VALUES ('org:o1','o1','j1','spend',-30,'daily',(now() AT TIME ZONE 'UTC')::date), ('org:o1','o1','j2','spend',-60,'daily',(now() AT TIME ZONE 'UTC')::date - 1)")
    await grantCredits(admin, "o1", { credits: 500, reason: why })
    const c = (await loadCredits("o1"))!
    expect(c).toMatchObject({ usedToday: 30, bonus: 500 })
    expect(c.week).toHaveLength(7)
    expect(c.week.at(-1)!.spent).toBeGreaterThanOrEqual(30)
    expect(c.week.at(-2)!.spent).toBe(60)
    expect(c.ledger[0]).toMatchObject({ kind: "grant", credits: 500, source: "bonus", actor: "admin@sail.test" })
  })
  it("does not show another workspace's credits", async () => {
    await grantCredits(admin, "o2", { credits: 100, reason: why })
    expect((await loadCredits("o1"))!.bonus).toBe(0)
  })
})

describe("granting", () => {
  it("adds bonus credits, audits it and tells the workspace", async () => {
    expect(await grantCredits(admin, "o1", { credits: 1500, reason: why })).toBe(1500)
    expect(await bonus()).toBe(1500)
    expect((await db.query("SELECT action, target, detail FROM company_audit_log")).rows).toEqual([{ action: "tenant.studio_credits.grant", target: "o1", detail: { credits: 1500, reason: why } }])
    const ev = (await db.query("SELECT action, details FROM workspace_access_events")).rows[0] as any
    expect(ev.action).toBe("staff_studio_credits_granted")
    expect(ev.details.credits).toBe(1500)
  })
  it("staff cannot, a reason is required, the amount must be a whole number of 1 or more", async () => {
    expect((await fail(grantCredits(staff, "o1", { credits: 10, reason: why })))?.status).toBe(403)
    expect((await fail(grantCredits(admin, "o1", { credits: 10, reason: "short" })))?.message).toMatch(/reason/)
    for (const bad of [0, -5, 2.5, Number.NaN]) expect((await fail(grantCredits(admin, "o1", { credits: bad, reason: why })))?.message, String(bad)).toMatch(/whole number/)
    expect((await fail(grantCredits(admin, "nope", { credits: 10, reason: why })))?.status).toBe(404)
    expect(await bonus()).toBe(0)
  })
  it("large grants need a superadmin and there is a hard ceiling", async () => {
    expect((await fail(grantCredits(admin, "o1", { credits: ADMIN_GRANT_CEILING + 1, reason: why })))?.status).toBe(403)
    expect(await grantCredits(admin, "o1", { credits: ADMIN_GRANT_CEILING, reason: why })).toBe(ADMIN_GRANT_CEILING)
    expect(await grantCredits(root, "o1", { credits: ADMIN_GRANT_CEILING + 1, reason: why })).toBe(ADMIN_GRANT_CEILING + 1)
    expect((await fail(grantCredits(root, "o1", { credits: MAX_GRANT + 1, reason: why })))?.message).toMatch(/at most/)
  })
})

describe("taking back", () => {
  it("takes back unspent bonus credits, never more than the balance", async () => {
    await grantCredits(admin, "o1", { credits: 300, reason: why })
    expect(await revokeCredits(admin, "o1", { credits: 100, reason: "Granted by mistake, ticket 78" })).toBe(100)
    expect(await bonus()).toBe(200)
    expect((await fail(revokeCredits(admin, "o1", { credits: 201, reason: "Granted by mistake, ticket 78" })))?.message).toMatch(/Only 200/)
    expect((await fail(revokeCredits(staff, "o1", { credits: 1, reason: "Granted by mistake, ticket 78" })))?.status).toBe(403)
    expect((await db.query("SELECT action FROM company_audit_log ORDER BY id")).rows.map((r: any) => r.action)).toEqual(["tenant.studio_credits.grant", "tenant.studio_credits.revoke"])
  })
})

describe("the daily allowance, through the plan form", () => {
  it('"unlimited" is stored as -1, because an absent limit means the 1,000 default', async () => {
    await saveEntitlements(admin, "o1", { plan: "fund_pro", features: {}, limits: { ai_studio_daily_credits: "unlimited" }, expectedVersion: 0, reason: "Design partner, ticket 5" })
    expect((await loadControl("o1"))!.limits.ai_studio_daily_credits).toBe(-1)
    expect((await loadCredits("o1"))).toMatchObject({ allowance: null, source: "override" })
    await saveEntitlements(admin, "o1", { plan: "fund_pro", features: {}, limits: { ai_studio_daily_credits: "3000" }, expectedVersion: 1, reason: "Pilot extension, ticket 6" })
    expect((await loadCredits("o1"))).toMatchObject({ allowance: 3000, source: "override" })
  })
})

describe("the price list", () => {
  it("lists prices and lets an admin change one with a reason, auditing the before and after", async () => {
    expect((await listRates()).find((r) => r.model === "qwen-image-2.0")).toMatchObject({ credits: 30, unit: "job", active: true })
    await saveRate(admin, { model: "qwen-image-2.0", resolution: "*", credits: 45, active: true, reason: "Invoice shows 50% more per image" })
    expect((await listRates()).find((r) => r.model === "qwen-image-2.0")!.credits).toBe(45)
    const a = (await db.query("SELECT action, detail FROM company_audit_log")).rows[0] as any
    expect(a.action).toBe("platform.studio_rate.set")
    expect(a.detail).toMatchObject({ from: { credits: 30, active: true }, to: { credits: 45, active: true } })
  })
  it("needs admin, a reason, a real price and an existing row", async () => {
    const base = { model: "qwen-image-2.0", resolution: "*", credits: 40, active: true, reason: "Invoice shows more per image" }
    expect((await fail(saveRate(staff, base)))?.status).toBe(403)
    expect((await fail(saveRate(admin, { ...base, reason: "x" })))?.message).toMatch(/reason/)
    expect((await fail(saveRate(admin, { ...base, credits: 0 })))?.message).toMatch(/whole number/)
    expect((await fail(saveRate(admin, { ...base, credits: 100_001 })))?.message).toMatch(/100,000/)
    expect((await fail(saveRate(admin, { ...base, model: "nothing" })))?.status).toBe(404)
  })
})
