/** Metadata-only inspection: reason required, bound to staff and org, expires, and leaves a tenant-visible event. */
import { describe, it, expect, vi, beforeAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"

const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({
  sql: (parts: TemplateStringsArray, ...v: unknown[]) => state.q(parts.reduce((q, p, i) => q + (i ? `$${i}` : "") + p, ""), v),
  query: (text: string, params: unknown[] = []) => state.q(text, params),
}))
import { startInspection, validInspection, tenantSummary } from "./inspect"

let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`
    CREATE TABLE organizations (id text PRIMARY KEY, name text, kind text, created_at timestamptz DEFAULT now(), archived_at timestamptz);
    CREATE TABLE memberships (org_id text, org_role text, persona text);
    CREATE TABLE billing_subscriptions (org_id text, status text, plan text, current_period_end timestamptz, updated_at timestamptz DEFAULT now());
    CREATE TABLE ai_calls (workspace_id text, task text, ok boolean, cost_usd numeric, created_at timestamptz DEFAULT now());
    CREATE TABLE crm_deals (org_id text, secret_note text);
    CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE workspace_access_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, org_id text, actor_user_id text, action text, target_user_id text, details jsonb, created_at timestamptz DEFAULT now());
    INSERT INTO organizations(id,name,kind) VALUES ('o1','Acme','company');
    INSERT INTO memberships VALUES ('o1','workspace_owner','founder');
    INSERT INTO crm_deals VALUES ('o1','TOP SECRET NOTE');
    INSERT INTO ai_calls VALUES ('o1','assistant_chat',true,0.01,now()),('o1','assistant_chat',false,0,now());`)
})
const staff = { id: "s1", email: "me@sail.test" }

describe("tenant inspection", () => {
  it("needs a real reason and a real org", async () => {
    await expect(startInspection(staff, "o1", "short")).rejects.toThrow(/Reason/)
    await expect(startInspection(staff, "nope", "billing question for ticket 42")).rejects.toThrow(/Unknown/)
  })
  it("is bound to the staff member, the org and the window, and tells the tenant", async () => {
    const id = await startInspection(staff, "o1", "billing question for ticket 42")
    expect(await validInspection("s1", "o1", id)).toMatchObject({ reason: "billing question for ticket 42" })
    expect(await validInspection("s2", "o1", id)).toBeNull()
    expect(await validInspection("s1", "o2", id)).toBeNull()
    await db.query("UPDATE company_audit_log SET created_at = now() - interval '16 minutes' WHERE id = $1", [id])
    expect(await validInspection("s1", "o1", id)).toBeNull()
    const ev = (await db.query("SELECT action, details FROM workspace_access_events")).rows as any[]
    expect(ev[0].action).toBe("staff_inspect")
  })
  it("returns counts and usage but never record contents", async () => {
    const s = await tenantSummary("o1")
    expect(s!.ai).toMatchObject({ calls30d: 2, failed30d: 1 })
    expect(s!.counts.find((c) => c.label === "CRM deals")!.n).toBe(1)
    expect(JSON.stringify(s)).not.toContain("TOP SECRET")
  })
})
