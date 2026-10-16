import { describe, it, expect, vi, beforeAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"

const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
import { loadPolicy, setPolicy, listSubprocessors, saveSubprocessor } from "./data-policy"
import { ControlError } from "./tenant-control"

let db: PGlite
const admin = { id: "a1", email: "admin@sail.test", role: "admin" as const }, staff = { id: "s1", email: "staff@sail.test", role: "staff" as const }
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as ControlError)
const why = "Fund asked for EU only, ticket 5"
const sp = { slug: "qwen", purpose: "Text and images", region: "sg", regionBasis: "inferred", dpaStatus: "unverified", trainingOptOut: "unverified", active: true, public: true, reason: why }
const audits = async () => (await db.query("SELECT action, target, detail FROM company_audit_log ORDER BY id")).rows as any[]

beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE organizations (id text PRIMARY KEY, name text);
    CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE workspace_access_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, org_id text, actor_user_id text, action text, target_user_id text, details jsonb, created_at timestamptz DEFAULT now());
    CREATE TABLE platform_flags (key text PRIMARY KEY, enabled boolean DEFAULT false, rollout_pct int DEFAULT 100, description text);
    CREATE TABLE ai_subprocessors (slug text PRIMARY KEY, provider text NOT NULL, role text NOT NULL, purpose text NOT NULL, region text NOT NULL DEFAULT 'unknown', region_basis text NOT NULL DEFAULT 'inferred', data_classes text[] NOT NULL DEFAULT '{}', dpa_status text NOT NULL DEFAULT 'unverified', training_opt_out text NOT NULL DEFAULT 'unverified', retention text, terms_url text, last_verified date, active boolean NOT NULL DEFAULT true, public boolean NOT NULL DEFAULT true, notes text, updated_by text, updated_at timestamptz DEFAULT now());
    CREATE TABLE workspace_data_policy (org_id text PRIMARY KEY, preset text NOT NULL DEFAULT 'standard', updated_by text, updated_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO organizations VALUES ('o1', 'Acme');
    INSERT INTO ai_subprocessors (slug, provider, role, purpose, region) VALUES ('qwen', 'Alibaba', 'ai_model', 'x', 'sg'), ('mistral', 'Mistral', 'ai_model', 'x', 'eu'), ('neon', 'Neon', 'database', 'x', 'us');
    INSERT INTO platform_flags (key, enabled) VALUES ('ai_self_hosted_lane', false);`)
}, 30000)

describe("workspace data policy", () => {
  it("defaults to standard and lists only AI providers' regions", async () => {
    const v = (await loadPolicy("o1"))!
    expect(v).toMatchObject({ preset: "standard", selfHostedAvailable: false }); expect(v.regions.map((r) => r.provider).sort()).toEqual(["Alibaba", "Mistral"])
    expect(await loadPolicy("nope")).toBeNull()
  })
  it("only admins set it; a reason is needed; an unknown policy and a missing workspace are refused", async () => {
    expect((await fail(setPolicy(staff, "o1", "eu_only", why)))?.status).toBe(403)
    expect(await fail(setPolicy(admin, "o1", "eu_only", "short"))).toBeInstanceOf(ControlError)
    expect(await fail(setPolicy(admin, "o1", "everything", why))).toBeInstanceOf(ControlError)
    expect((await fail(setPolicy(admin, "nope", "eu_only", why)))?.status).toBe(404)
    expect((await loadPolicy("o1"))!.preset).toBe("standard")
  })
  it("saves EU only, audits before and after, and writes the workspace's own log", async () => {
    await setPolicy(admin, "o1", "eu_only", why)
    expect(await loadPolicy("o1")).toMatchObject({ preset: "eu_only", updatedBy: "admin@sail.test" })
    expect((await audits()).find((a) => a.action === "platform.data_policy.set")).toMatchObject({ target: "o1", detail: { from: "standard", to: "eu_only", reason: why } })
    expect(Number(((await db.query("SELECT count(*)::int n FROM workspace_access_events WHERE org_id='o1' AND action='staff_data_policy_set'")).rows[0] as any).n)).toBe(1)
  })
  it("refuses no-external-provider until a self-hosted model is running", async () => {
    expect((await fail(setPolicy(admin, "o1", "no_external", why)))?.message).toMatch(/No self-hosted model/)
    await db.exec("UPDATE platform_flags SET enabled = true WHERE key = 'ai_self_hosted_lane'")
    await setPolicy(admin, "o1", "no_external", why)
    expect((await loadPolicy("o1"))!.preset).toBe("no_external")
    await db.exec("UPDATE platform_flags SET enabled = false")
  })
})

describe("sub-processor register", () => {
  it("lists providers, and edits need an admin, a reason and valid values", async () => {
    expect((await listSubprocessors()).length).toBe(3)
    expect((await fail(saveSubprocessor(staff, sp)))?.status).toBe(403)
    expect(await fail(saveSubprocessor(admin, { ...sp, reason: "x" }))).toBeInstanceOf(ControlError)
    for (const bad of [{ region: "mars" }, { regionBasis: "guess" }, { dpaStatus: "maybe" }, { trainingOptOut: "perhaps" }, { termsUrl: "http://x.com" }, { purpose: " " }]) expect(await fail(saveSubprocessor(admin, { ...sp, ...bad })), JSON.stringify(bad)).toBeInstanceOf(ControlError)
    expect((await fail(saveSubprocessor(admin, { ...sp, slug: "nope" })))?.status).toBe(404)
  })
  it("a confirmed region, a signed agreement or a training opt-out must carry the date it was checked", async () => {
    for (const bad of [{ regionBasis: "confirmed" }, { dpaStatus: "signed" }, { trainingOptOut: "yes" }]) expect((await fail(saveSubprocessor(admin, { ...sp, ...bad })))?.message, JSON.stringify(bad)).toMatch(/date you checked/)
    await saveSubprocessor(admin, { ...sp, regionBasis: "confirmed", dpaStatus: "signed", trainingOptOut: "yes", lastVerified: "2026-10-20", termsUrl: "https://example.com/terms", dataClasses: "prompts, decks" })
    const q = (await listSubprocessors()).find((x) => x.slug === "qwen")!
    expect(q).toMatchObject({ region_basis: "confirmed", dpa_status: "signed", training_opt_out: "yes", last_verified: "2026-10-20", data_classes: ["prompts", "decks"], updated_by: "admin@sail.test" })
    expect((await audits()).find((a) => a.action === "platform.subprocessor.set")).toMatchObject({ target: "qwen", detail: { reason: why } })
  })
})
