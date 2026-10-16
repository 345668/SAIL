import { describe, it, expect, vi, beforeAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"

const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
import { listRules, saveRule, saveQuiet, MAX_MUTE_DAYS, RULES } from "./alert-rules"
import { ControlError } from "./tenant-control"

let db: PGlite
const admin = { id: "a1", email: "admin@sail.test", role: "admin" as const }, staff = { id: "s1", email: "staff@sail.test", role: "staff" as const }
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as ControlError)
const why = "Known issue, fix due Monday"
const base = { key: "ai_failure_rate", enabled: true, severity: "", reason: why }
const audits = async () => (await db.query("SELECT action, target, detail FROM company_audit_log ORDER BY id")).rows as any[]
const get = async (k: string) => (await db.query("SELECT * FROM alert_rule_settings WHERE rule_key = $1", [k])).rows[0] as any

beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE alert_rule_settings (rule_key text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true, severity_override integer, threshold jsonb NOT NULL DEFAULT '{}', muted_until timestamptz, muted_reason text, updated_by text, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE alert_incidents (id bigserial PRIMARY KEY, rule_key text NOT NULL, subject text NOT NULL, severity int NOT NULL, status text NOT NULL, resolved_at timestamptz, resolved_by text, acknowledged_by text, opened_at timestamptz);
    CREATE TABLE alert_events (id bigserial PRIMARY KEY, incident_id bigint, kind text);`)
}, 30000)

describe("listing and precision", () => {
  it("lists every rule with defaults, and computes the 30-day precision from what people did", async () => {
    await db.exec(`INSERT INTO alert_incidents (rule_key, subject, severity, status, resolved_at, resolved_by, acknowledged_by, opened_at) VALUES
      ('cron_stale','a',2,'resolved', now() - interval '2 days','ops@sail.test',NULL, now() - interval '3 days'),
      ('cron_stale','b',2,'resolved', now() - interval '2 days','auto','ops@sail.test', now() - interval '3 days'),
      ('cron_stale','c',2,'resolved', now() - interval '2 days','auto',NULL, now() - interval '3 days'),
      ('cron_stale','d',2,'resolved', now() - interval '2 days','auto',NULL, now() - interval '3 days'),
      ('cron_stale','old',2,'resolved', now() - interval '60 days','ops@sail.test',NULL, now() - interval '61 days'),
      ('cron_stuck','e',2,'open', NULL, NULL, NULL, now())`)
    const { rules, quiet } = await listRules()
    expect(rules).toHaveLength(RULES.length); expect(quiet).toEqual({ start: 22, end: 7 })
    expect(rules.find((r) => r.key === "cron_stale")).toMatchObject({ resolved30: 4, acted30: 2, precision: 50 })
    expect(rules.find((r) => r.key === "cron_stuck")).toMatchObject({ open: 1, precision: null })
    expect(rules.find((r) => r.key === "dependency_degraded")!.defaultSeverity).toBe(3)
  })
})
describe("changing a rule", () => {
  it("only admins, with a reason, and an unknown rule is a 404", async () => {
    expect((await fail(saveRule(staff, base)))?.status).toBe(403)
    expect(await fail(saveRule(admin, { ...base, reason: "x" }))).toBeInstanceOf(ControlError)
    expect((await fail(saveRule(admin, { ...base, key: "nope" })))?.status).toBe(404)
  })
  it("saves a threshold within range and refuses one outside it", async () => {
    await saveRule(admin, { ...base, rate: "0.05", minCalls: "20", windowMin: "30" })
    expect((await get("ai_failure_rate")).threshold).toEqual({ rate: 0.05, minCalls: 20, windowMin: 30 })
    for (const bad of [{ rate: "5" }, { rate: "0" }, { minCalls: "0" }, { minCalls: "5000" }, { windowMin: "500" }, { rate: "abc" }]) expect(await fail(saveRule(admin, { ...base, ...bad })), JSON.stringify(bad)).toBeInstanceOf(ControlError)
  })
  it("a threshold is ignored for a rule that has none", async () => {
    await saveRule(admin, { ...base, key: "cron_stale", rate: "0.9" }); expect((await get("cron_stale")).threshold).toEqual({})
  })
  it("severity is 1, 2 or 3 or blank for the default", async () => {
    await saveRule(admin, { ...base, key: "cron_failing", severity: "1" }); expect((await get("cron_failing")).severity_override).toBe(1)
    await saveRule(admin, { ...base, key: "cron_failing", severity: "" }); expect((await get("cron_failing")).severity_override).toBeNull()
    for (const bad of ["0", "4", "1.5", "high"]) expect(await fail(saveRule(admin, { ...base, key: "cron_failing", severity: bad })), bad).toBeInstanceOf(ControlError)
  })
  it("a mute is time-limited (at most 30 days), keeps its reason, survives other edits, and can be lifted", async () => {
    const now = Date.UTC(2026, 9, 16, 12)
    expect(await fail(saveRule(admin, { ...base, key: "cron_stuck", muteDays: String(MAX_MUTE_DAYS + 1) }, now))).toBeInstanceOf(ControlError)
    await saveRule(admin, { ...base, key: "cron_stuck", muteDays: "7" }, now)
    expect(new Date((await get("cron_stuck")).muted_until).toISOString()).toBe("2026-10-23T12:00:00.000Z"); expect((await get("cron_stuck")).muted_reason).toBe(why)
    await saveRule(admin, { ...base, key: "cron_stuck", severity: "1", reason: "Raising severity while muted" }, now)
    expect((await get("cron_stuck")).muted_until).not.toBeNull()                                  // saving other fields leaves the mute alone
    expect((await listRules(now)).rules.find((r) => r.key === "cron_stuck")!.mutedUntil).toBe("2026-10-23T12:00:00.000Z")
    expect((await listRules(now + 8 * 86_400_000)).rules.find((r) => r.key === "cron_stuck")!.mutedUntil).toBeNull()   // expired
    await saveRule(admin, { ...base, key: "cron_stuck", unmute: true, reason: "Fixed, lifting the mute" }, now)
    expect((await get("cron_stuck")).muted_until).toBeNull()
  })
  it("turning a rule off is recorded, and every change is audited with before and after and the reason", async () => {
    await saveRule(admin, { ...base, key: "dependency_degraded", enabled: false, reason: "Too noisy this week" })
    expect((await get("dependency_degraded")).enabled).toBe(false)
    const a = (await audits()).filter((x) => x.action === "platform.alert_rule.set" && x.target === "dependency_degraded")
    expect(a[0].detail).toMatchObject({ to: { enabled: false }, reason: "Too noisy this week" })
  })
})
describe("quiet hours", () => {
  it("saves whole hours with a reason, refuses an empty window and non-admins, and listRules reads it back", async () => {
    expect((await fail(saveQuiet(staff, "21", "8", why)))?.status).toBe(403)
    for (const [s, e] of [["25", "7"], ["22", "7.5"], ["8", "8"], ["x", "7"]]) expect(await fail(saveQuiet(admin, s, e, why)), `${s}-${e}`).toBeInstanceOf(ControlError)
    expect(await fail(saveQuiet(admin, "21", "8", "no"))).toBeInstanceOf(ControlError)
    await saveQuiet(admin, "21", "8", "Founder starts later")
    expect((await listRules()).quiet).toEqual({ start: 21, end: 8 })
    expect((await audits()).find((a) => a.action === "platform.alert_quiet.set")).toMatchObject({ detail: { start: 21, end: 8 } })
  })
})
