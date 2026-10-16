import { describe, it, expect, vi, beforeAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"

const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
import { heartbeat, listOpen, listRecent, timeline, acknowledge, addNote, resolve } from "./alerts"
import { ControlError } from "./tenant-control"

let db: PGlite
const admin = { id: "a1", email: "admin@sail.test", role: "admin" as const }, staff = { id: "s1", email: "staff@sail.test", role: "staff" as const }
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as ControlError)
const row = async (id: number) => (await db.query("SELECT * FROM alert_incidents WHERE id = $1", [id])).rows[0] as any
const audits = async () => (await db.query("SELECT action, target, detail FROM company_audit_log ORDER BY id")).rows as any[]
const add = async (status = "open", sev = 2, rule = "dependency_down", subject = "Stripe billing") =>
  Number(((await db.query("INSERT INTO alert_incidents (rule_key, subject, severity, status, summary, runbook, opened_at) VALUES ($1,$2,$3,$4,'sum','What it means: x', now()) RETURNING id", [rule, subject + Math.random(), sev, status])).rows[0] as any).id)

beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE alert_incidents (id bigserial PRIMARY KEY, rule_key text NOT NULL, subject text NOT NULL, severity integer NOT NULL, status text NOT NULL DEFAULT 'pending', summary text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}', runbook text, opened_at timestamptz, first_seen_at timestamptz DEFAULT now(), last_seen_at timestamptz DEFAULT now(), times_seen integer NOT NULL DEFAULT 1, acknowledged_by text, acknowledged_at timestamptz, resolved_at timestamptz, resolved_by text, cause text, fix text);
    CREATE TABLE alert_events (id bigserial PRIMARY KEY, incident_id bigint NOT NULL, at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, channel text, ok boolean, actor text, detail text);
    CREATE TABLE alert_heartbeat (id integer PRIMARY KEY, last_run_at timestamptz, last_ok_at timestamptz, rules_evaluated integer NOT NULL DEFAULT 0, open_incidents integer NOT NULL DEFAULT 0, error text);
    INSERT INTO alert_heartbeat (id) VALUES (1);`)
}, 30000)

describe("heartbeat", () => {
  it("is stale when never run, fresh within 30 minutes, stale after", async () => {
    expect((await heartbeat()).stale).toBe(true)
    const now = Date.now()
    await db.query("UPDATE alert_heartbeat SET last_ok_at = $1, last_run_at = $1, rules_evaluated = 4", [new Date(now - 5 * 60000).toISOString()])
    expect(await heartbeat(now)).toMatchObject({ stale: false, ageMinutes: 5, rules_evaluated: 4 })
    expect((await heartbeat(now + 40 * 60000)).stale).toBe(true)
  })
})
describe("listing", () => {
  it("shows open and acknowledged incidents by severity, hides pending and resolved, and resolved ones appear in the recent list", async () => {
    await db.exec("DELETE FROM alert_incidents")
    const a = await add("open", 2), b = await add("open", 1), c = await add("acknowledged", 2), p = await add("pending"), r = await add("resolved")
    await db.query("UPDATE alert_incidents SET resolved_at = now(), resolved_by = 'auto' WHERE id = $1", [r])
    expect((await listOpen()).map((i) => i.id)).toEqual([b, a, c].sort((x, y) => 0) && [b, a, c])
    expect((await listRecent()).map((i) => i.id)).toEqual([r]); expect(p).toBeGreaterThan(0)
  })
})
describe("acting on an incident", () => {
  it("only admins act", async () => {
    const id = await add()
    for (const f of [() => acknowledge(staff, id), () => addNote(staff, id, "x"), () => resolve(staff, id, { cause: "a long enough cause", fix: "a long enough fix" })]) expect((await fail(f()))?.status).toBe(403)
  })
  it("acknowledging records who and when, once, and audits without evidence", async () => {
    const id = await add()
    await acknowledge(admin, id, "looking now")
    expect(await row(id)).toMatchObject({ status: "acknowledged", acknowledged_by: "admin@sail.test" })
    expect((await fail(acknowledge(admin, id)))?.status).toBe(409)
    expect((await timeline(id)).map((e) => e.kind)).toEqual(["acknowledged"]); expect((await timeline(id))[0].detail).toBe("looking now")
    expect((await audits()).find((a) => a.action === "platform.alert.acknowledge")).toMatchObject({ target: String(id) })
  })
  it("a note needs text and is added to the timeline", async () => {
    const id = await add()
    expect(await fail(addNote(admin, id, "  "))).toBeInstanceOf(ControlError)
    await addNote(admin, id, "Stripe dashboard: webhook created, secret pending")
    expect((await timeline(id))[0]).toMatchObject({ kind: "note", actor: "admin@sail.test" })
    expect((await fail(addNote(admin, 999999, "x")))?.status).toBe(404)
  })
  it("resolving needs a cause and a fix, records them with who, and cannot be repeated", async () => {
    const id = await add()
    expect(await fail(resolve(admin, id, { cause: "short", fix: "also short" }))).toBeInstanceOf(ControlError)
    await resolve(admin, id, { cause: "STRIPE_WEBHOOK_SECRET was never set in Vercel", fix: "Created the webhook and set the secret" })
    expect(await row(id)).toMatchObject({ status: "resolved", resolved_by: "admin@sail.test", cause: "STRIPE_WEBHOOK_SECRET was never set in Vercel", fix: "Created the webhook and set the secret" })
    expect((await fail(resolve(admin, id, { cause: "another cause here", fix: "another fix here" })))?.status).toBe(409)
    expect((await listRecent())[0].cause).toContain("never set")
  })
})
