/** Staff sending control: metadata only, a reason on every pause, admins only. */
import { describe, it, expect, vi, beforeAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"
const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({
  sql: (parts: TemplateStringsArray, ...v: unknown[]) => state.q(parts.reduce((q, p, i) => q + (i ? `$${i}` : "") + p, ""), v),
  query: (text: string, params: unknown[] = []) => state.q(text, params),
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))
import { overview, setSendingPaused, PAUSE_KEY } from "./sending-control"

let db: PGlite
const admin = { id: "s1", email: "a@x.test", role: "admin" as const }, staff = { id: "s2", email: "s@x.test", role: "staff" as const }
beforeAll(async () => {
  db = new PGlite(); state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE platform_flags (key text PRIMARY KEY, enabled boolean DEFAULT false, rollout_pct int DEFAULT 100, description text, updated_by text, updated_at timestamptz DEFAULT now());
    CREATE TABLE organizations (id text PRIMARY KEY, name text);
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
})
