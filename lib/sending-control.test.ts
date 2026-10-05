/** Staff sending control: metadata only, a reason on every pause, admins only. */
import { describe, it, expect, vi, beforeAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"
const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({
  sql: (parts: TemplateStringsArray, ...v: unknown[]) => state.q(parts.reduce((q, p, i) => q + (i ? `$${i}` : "") + p, ""), v),
  query: (text: string, params: unknown[] = []) => state.q(text, params),
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))
import { overview, setSendingPaused, setEnforcement, PAUSE_KEY, ENFORCE_KEY } from "./sending-control"
const superadmin = { id: "s0", email: "z@x.test", role: "superadmin" as const }

let db: PGlite
const admin = { id: "s1", email: "a@x.test", role: "admin" as const }, staff = { id: "s2", email: "s@x.test", role: "staff" as const }
beforeAll(async () => {
  db = new PGlite(); state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE platform_flags (key text PRIMARY KEY, enabled boolean DEFAULT false, rollout_pct int DEFAULT 100, description text, updated_by text, updated_at timestamptz DEFAULT now());
    CREATE TABLE organizations (id text PRIMARY KEY, name text);
    CREATE TABLE audit_events (action text, target_label text, created_at timestamptz DEFAULT now());
    CREATE TABLE send_authorizations (id text PRIMARY KEY, status text);
    CREATE TABLE send_items (id serial PRIMARY KEY, org_id text, status text, send_after timestamptz DEFAULT now(), claimed_at timestamptz, sent_at timestamptz, created_at timestamptz DEFAULT now(), recipients jsonb, reason text);
    INSERT INTO organizations VALUES ('o1','Acme');
    INSERT INTO send_authorizations VALUES ('a1','active'), ('a2','completed');
    INSERT INTO send_items (org_id, status, sent_at, recipients, reason) VALUES ('o1','sent', now(), '{"to":"secret@person.test"}', 'Not copied to: secret2@person.test'), ('o1','sent', now(), '{}', NULL);
    INSERT INTO send_items (org_id, status, send_after, recipients) VALUES ('o1','approved', now() - interval '2 hours', '{}');
    INSERT INTO send_items (org_id, status, claimed_at, recipients, reason) VALUES ('o1','unknown', now() - interval '3 hours', '{"to":"hide@me.test"}', 'check Sent mail for hide@me.test'), ('o1','failed', NULL, '{}', 'Resend 422 bad@x.test');`)
})
describe("sending control", () => {
  it("shows counts, ages and workspace names, and never a recipient or a reason", async () => {
    const o = await overview()
    expect(o.sentToday).toBe(2); expect(o.waiting.n).toBe(1); expect(o.waiting.oldestMinutes).toBeGreaterThanOrEqual(119); expect(o.activeAuthorizations).toBe(1)
    expect(o.counts).toEqual(expect.arrayContaining([{ status: "sent", n: 2 }, { status: "approved", n: 1 }]))
    expect(o.problems).toEqual(expect.arrayContaining([expect.objectContaining({ org_name: "Acme", status: "unknown", n: 1 }), expect.objectContaining({ org_name: "Acme", status: "failed", n: 1 })]))
    expect(JSON.stringify(o)).not.toMatch(/secret|hide@me|bad@x|Sent mail|Resend 422/)
    expect(o.paused.on).toBe(false)
  })
  it("pauses and resumes with a reason, as a platform flag the executor reads", async () => {
    await setSendingPaused(admin, true, "Stopping while we check a bounce spike")
    expect((await overview()).paused.on).toBe(true); expect((await db.query("SELECT enabled FROM platform_flags WHERE key = $1", [PAUSE_KEY])).rows[0]).toEqual({ enabled: true })
    await setSendingPaused(admin, false, "Bounces explained, resuming now"); expect((await overview()).paused.on).toBe(false)
  })
  it("refuses staff and a missing reason", async () => {
    await expect(setSendingPaused(staff, true, "Not allowed to do this")).rejects.toThrow(/Only admins/)
    await expect(setSendingPaused(admin, true, "short")).rejects.toThrow(/reason/)
  })
  it("enforcement can be turned on only after a quiet fortnight, only by a superadmin, and off any time", async () => {
    await expect(setEnforcement(admin, true, 100, "Switching it on now please")).rejects.toThrow(/Only a superadmin/)
    // A quiet log means nothing until it has been recording for the whole fortnight: not started, then started 3 days ago, both refused.
    await expect(setEnforcement(superadmin, true, 25, "Fourteen quiet days, starting with a quarter")).rejects.toThrow(/recording for 0 days/)
    await db.exec("INSERT INTO platform_flags (key, enabled, updated_at) VALUES ('outreach_shadow_log_started', true, now() - interval '3 days')")
    expect((await overview()).enforcement).toMatchObject({ observedDays: 3 })
    await expect(setEnforcement(superadmin, true, 25, "Fourteen quiet days, starting with a quarter")).rejects.toThrow(/recording for 3 days.*14 quiet days/)
    await db.exec("UPDATE platform_flags SET updated_at = now() - interval '15 days' WHERE key = 'outreach_shadow_log_started'")
    await db.exec("UPDATE platform_flags SET updated_at = now() - interval '3 days' WHERE key = 'outreach_shadow_log_started'"); await db.exec("UPDATE platform_flags SET updated_at = now() - interval '15 days' WHERE key = 'outreach_shadow_log_started'")
    await db.exec("INSERT INTO audit_events (action, target_label, created_at) VALUES ('send.unauthorized_path','investor-update', now() - interval '3 days'), ('send.unauthorized_path','investor-update', now() - interval '2 days'), ('send.unauthorized_path','lp-send-one', now() - interval '20 days')")
    const o = await overview(); expect(o.enforcement.unauthorized).toEqual([expect.objectContaining({ path: "investor-update", n: 2 })]) // the 20-day-old one is outside the window
    await expect(setEnforcement(superadmin, true, 100, "Switching it on now please")).rejects.toThrow(/Not yet.*investor-update 2.*14 quiet days/)
    expect((await db.query("SELECT enabled FROM platform_flags WHERE key = $1", [ENFORCE_KEY])).rows).toEqual([])
    await db.exec("DELETE FROM audit_events WHERE created_at > now() - interval '14 days'")
    await setEnforcement(superadmin, true, 25, "Fourteen quiet days, starting with a quarter")
    expect((await db.query("SELECT enabled, rollout_pct FROM platform_flags WHERE key = $1", [ENFORCE_KEY])).rows[0]).toEqual({ enabled: true, rollout_pct: 25 })
    expect((await overview()).enforcement).toMatchObject({ on: true, rolloutPct: 25 })
    await setEnforcement(superadmin, false, 100, "Turning it back off to look"); expect((await overview()).enforcement.on).toBe(false)
  })
})

