/** Activation is derived from product tables: the loop is complete only when match, draft, send and reply all exist. */
import { describe, it, expect, vi, beforeAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"
const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
import { loadActivation } from "./activation"

beforeAll(async () => {
  const db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`
    CREATE TABLE organizations (id text PRIMARY KEY, name text, kind text, created_at timestamptz, archived_at timestamptz);
    CREATE TABLE memberships (org_id text, user_id text);
    CREATE TABLE startup_profiles (org_id text, created_at timestamptz);
    CREATE TABLE founder_match_runs (org_id text, created_at timestamptz);
    CREATE TABLE outreach_messages (user_id text, created_at timestamptz DEFAULT now(), sent_at timestamptz);
    CREATE TABLE outreach_replies (user_id text, received_at timestamptz);
    CREATE TABLE ai_calls (workspace_id text, actor_id text, created_at timestamptz DEFAULT now());
    CREATE TABLE crm_deals (created_by text, created_at timestamptz DEFAULT now());
    INSERT INTO organizations VALUES ('full','Full','company', now() - interval '10 days', NULL), ('half','Half','company', now() - interval '5 days', NULL), ('empty','Empty','fund', now(), NULL), ('gone','Gone','company', now(), now());
    INSERT INTO memberships VALUES ('full','uf'),('half','uh'),('empty','ue');
    INSERT INTO startup_profiles VALUES ('full', now() - interval '9 days');
    INSERT INTO founder_match_runs VALUES ('full', now() - interval '8 days'),('half', now() - interval '4 days');
    INSERT INTO outreach_messages VALUES ('uf', now(), now()),('uh', now(), NULL);
    INSERT INTO outreach_replies VALUES ('uf', now());
    INSERT INTO ai_calls VALUES ('full','uf', now());`)
})

describe("activation", () => {
  it("counts steps per workspace, skips archived ones, and completes the loop only with all four", async () => {
    const a = await loadActivation()
    expect(a.orgs.map((o) => o.id).sort()).toEqual(["empty", "full", "half"])
    const by = Object.fromEntries(a.orgs.map((o) => [o.id, o]))
    expect(by.full.loopComplete).toBe(true); expect(by.full.stepsReached).toBe(5)
    expect(by.half.loopComplete).toBe(false); expect(by.half.reached).toMatchObject({ matched: true, drafted: true, sent: false, replied: false })
    expect(by.empty.stepsReached).toBe(0)
    expect(a.loopComplete).toBe(1)
    expect(a.funnel.find((f) => f.step === "matched")!.orgs).toBe(2)
  })
  it("time to first match is hours from creation, and the median and active users are right", async () => {
    const a = await loadActivation()
    const by = Object.fromEntries(a.orgs.map((o) => [o.id, o]))
    expect(Math.round(by.full.hoursToFirstValue!)).toBe(48); expect(Math.round(by.half.hoursToFirstValue!)).toBe(24)
    expect(Math.round(a.medianHoursToFirstValue!)).toBe(24)
    expect(a.wau).toBe(2); expect(a.mau).toBe(2)
  })
})
