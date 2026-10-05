/** Staff agent control: metadata only, a reason on every pause, admins only, and the flag keys Anker reads. */
import { describe, it, expect, vi, beforeAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"
const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({
  sql: (parts: TemplateStringsArray, ...v: unknown[]) => state.q(parts.reduce((q, p, i) => q + (i ? `$${i}` : "") + p, ""), v),
  query: (text: string, params: unknown[] = []) => state.q(text, params),
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))
import { overview, setPaused, flagKeyFor } from "./agents-control"

let db: PGlite
const admin = { id: "s1", email: "a@x.test", role: "admin" as const }, staff = { id: "s2", email: "s@x.test", role: "staff" as const }
beforeAll(async () => {
  db = new PGlite(); state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE platform_flags (key text PRIMARY KEY, enabled boolean DEFAULT false, rollout_pct int DEFAULT 100, description text, updated_by text, updated_at timestamptz DEFAULT now());
    CREATE TABLE organizations (id text PRIMARY KEY, name text);
    CREATE TABLE agent_executions (id text PRIMARY KEY, org_id text, agent_id text, status text, error text, plan jsonb, output jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE agent_settings (org_id text, agent_id text, enabled boolean);
    CREATE TABLE eval_runs (id bigserial PRIMARY KEY, suite text, case_name text, passed boolean, detail text, ran_at timestamptz DEFAULT now());
    INSERT INTO organizations VALUES ('o1','Acme');
    INSERT INTO agent_executions (id, org_id, agent_id, status, error, plan, output) VALUES ('e1','o1','pipeline_keeper','failed','boom','[{"secret":"plan"}]','{"secret":"output"}'), ('e2','o1','weekly_brief','succeeded',NULL,'[]','{"secret":"output"}');
    INSERT INTO agent_settings VALUES ('o1','pipeline_keeper',true);
    INSERT INTO eval_runs (suite, case_name, passed, detail, ran_at) VALUES ('live','x',false,'old', now() - interval '1 day'), ('live','x',true,'ok', now());`)
})
describe("agents control", () => {
  it("uses the flag keys Anker's runtime reads", () => { expect(flagKeyFor(null)).toBe("agents_disabled"); expect(flagKeyFor("weekly_brief")).toBe("agents_disabled_weekly_brief") })
  it("shows counts, statuses, errors and workspace names, and never a plan or an output", async () => {
    const o = await overview()
    expect(o.runs).toEqual(expect.arrayContaining([{ agent_id: "pipeline_keeper", status: "failed", n: 1 }]))
    expect(o.problems[0]).toMatchObject({ agent_id: "pipeline_keeper", org_name: "Acme", error: "boom" })
    expect(JSON.stringify(o)).not.toMatch(/secret/)
    expect(o.workspaces).toEqual([{ agent_id: "pipeline_keeper", enabled: 1 }])
    expect(o.evals).toHaveLength(1); expect(o.evals[0].passed).toBe(true) // the latest result per case
  })
  it("pauses and resumes with a reason, audited by the flag editor", async () => {
    await setPaused(admin, "weekly_brief", true, "A bad run in production")
    expect((await overview()).paused.weekly_brief.on).toBe(true)
    await setPaused(admin, null, true, "Stopping everything while we look")
    const o = await overview(); expect(o.paused["*"].on).toBe(true)
    await setPaused(admin, null, false, "All clear, resuming now"); expect((await overview()).paused["*"].on).toBe(false)
  })
  it("refuses staff, a missing reason and an unknown agent", async () => {
    await expect(setPaused(staff, "weekly_brief", true, "Not allowed to do this")).rejects.toThrow(/Only admins/)
    await expect(setPaused(admin, "weekly_brief", true, "short")).rejects.toThrow(/reason/)
    await expect(setPaused(admin, "made_up", true, "A long enough reason")).rejects.toThrow(/Unknown agent/)
  })
})
