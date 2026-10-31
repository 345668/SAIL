import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { PGlite } from "@electric-sql/pglite"

const state = vi.hoisted(() => ({ q: null as any, calls: [] as any[], status: 200, body: {} as any }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
vi.mock("./anker-proxy", () => ({ forwardToAnker: async (i: any) => { state.calls.push(i); return new Response(JSON.stringify(state.body), { status: state.status }) } }))
import { counts, listCandidates, decide, reopen, runDetectionNow, PAGE, planPair, describePlan, mergePair, undoPair, applyHierarchy, mergeOf } from "./directory-identity"
import { ControlError } from "./tenant-control"

let db: PGlite
const admin = { id: "a1", email: "admin@sail.test", role: "admin" as const }, staff = { id: "s1", email: "staff@sail.test", role: "staff" as const }
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as ControlError)
const row = async (id: number) => (await db.query("SELECT * FROM directory_candidates WHERE id = $1", [id])).rows[0] as any
const audits = async () => (await db.query("SELECT action, target, detail FROM company_audit_log ORDER BY id")).rows as any[]
const add = async (kind: string, a: string, b: string, tier = "probable", score = 80, suggest = "same") => Number(((await db.query("INSERT INTO directory_candidates (kind, a_id, b_id, tier, score, suggest, evidence) VALUES ($1,$2,$3,$4,$5,$6,'{}') RETURNING id", [kind, a, b, tier, score, suggest])).rows[0] as any).id)

beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE investment_firms (id text PRIMARY KEY, name text, website text, source text, hq_location text, location text);
    CREATE TABLE investors (id text PRIMARY KEY, first_name text, last_name text, title text, email text, linkedin_url text, person_linkedin_url text, source text, firm_id text);
    CREATE TABLE directory_candidates (id bigserial PRIMARY KEY, kind text NOT NULL, a_id text NOT NULL, b_id text NOT NULL, tier text NOT NULL, score integer NOT NULL DEFAULT 0, suggest text NOT NULL DEFAULT 'same', evidence jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'open', parent_id text, decided_by text, decided_at timestamptz, reason text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    INSERT INTO investment_firms VALUES ('f1','Spring Capital','springcapital.com','folk','Berlin',NULL), ('f2','Spring Capital Ltd',NULL,'drop',NULL,'Berlin');
    INSERT INTO investors VALUES ('p1','Anna','Berg','Partner','a@x.com',NULL,'https://linkedin.com/in/anna','folk','f1'), ('p2','Anna','Berg',NULL,'a@x.com',NULL,NULL,'drop','f2'), ('p3','Carl','Stein',NULL,NULL,NULL,NULL,'folk','f1');`)
}, 30000)
beforeEach(() => { state.calls.length = 0; state.status = 200; state.body = {} })

describe("directory identity queue", () => {
  it("lists a pair with both records and the firms' people counts, and hides the noisy tier by default", async () => {
    const id = await add("firm", "f1", "f2", "probable", 90)
    await add("firm", "f1", "f2x", "possible", 20)
    const l = await listCandidates({ kind: "firm", tiers: [], status: "open", page: 0 })
    expect(l.total).toBe(1); expect(l.items[0]).toMatchObject({ id, tier: "probable" })
    expect(l.items[0].a).toMatchObject({ name: "Spring Capital", people: 2, location: "Berlin" }); expect(l.items[0].b).toMatchObject({ name: "Spring Capital Ltd", people: 1, location: "Berlin" })
    expect((await listCandidates({ kind: "firm", tiers: ["certain", "probable", "possible"], status: "open", page: 0 })).total).toBe(2)
    await db.exec("DELETE FROM directory_candidates")
  })
  it("orders certain before probable before possible, then by score, and pages", async () => {
    await db.exec("DELETE FROM directory_candidates")
    await add("person", "p1", "p2", "probable", 99); const c = await add("person", "p1", "p3", "certain", 10); await add("person", "p2", "p3", "possible", 99)
    const l = await listCandidates({ kind: "person", tiers: ["certain", "probable", "possible"], status: "open", page: 0 })
    expect(l.items.map((i) => i.tier)).toEqual(["certain", "probable", "possible"]); expect(l.items[0].id).toBe(c)
    expect(l.items[0].a).toMatchObject({ name: "Anna Berg", firm: "Spring Capital" })
    for (let i = 0; i < PAGE + 2; i++) await add("firm", `x${i}`, `y${i}`, "probable", i)
    expect((await listCandidates({ kind: "firm", tiers: [], status: "open", page: 0 })).items).toHaveLength(PAGE)
    expect((await listCandidates({ kind: "firm", tiers: [], status: "open", page: 1 })).items).toHaveLength(2)
    await db.exec("DELETE FROM directory_candidates")
  })
  it("only admins decide; a decision is recorded with who, when and why, and audited by ids only", async () => {
    const id = await add("firm", "f1", "f2")
    expect((await fail(decide(staff, id, "distinct")))?.status).toBe(403)
    expect(await fail(decide(admin, id, "maybe"))).toBeInstanceOf(ControlError)
    await decide(admin, id, "distinct", { reason: "Two separate funds" })
    expect(await row(id)).toMatchObject({ status: "distinct", decided_by: "admin@sail.test", reason: "Two separate funds" })
    expect((await audits()).find((a) => a.action === "platform.directory_candidate.decide")).toMatchObject({ target: String(id), detail: { decision: "distinct", a: "f1", b: "f2" } })
    expect((await fail(decide(admin, id, "same")))?.status).toBe(409)   // already decided
    expect((await fail(decide(admin, 999999, "same")))?.status).toBe(404)
  })
  it("related needs a parent that is one of the pair, and only firms can be related", async () => {
    const f = await add("firm", "f1", "f2", "probable", 60, "related"), p = await add("person", "p1", "p2")
    expect((await fail(decide(admin, f, "related")))?.message).toMatch(/parent/)
    expect((await fail(decide(admin, f, "related", { parentId: "zzz" })))?.message).toMatch(/parent/)
    expect((await fail(decide(admin, p, "related", { parentId: "p1" })))?.message).toMatch(/Only firms/)
    await decide(admin, f, "related", { parentId: "f1" })
    expect(await row(f)).toMatchObject({ status: "related", parent_id: "f1" })
  })
  it("'same' is recorded as confirmed and waiting for the merge slice: nothing is merged and no directory record changes", async () => {
    const before = JSON.stringify((await db.query("SELECT * FROM investment_firms ORDER BY id")).rows)
    const id = await add("firm", "f1", "f2"); await decide(admin, id, "same")
    expect((await row(id)).status).toBe("same")
    expect(JSON.stringify((await db.query("SELECT * FROM investment_firms ORDER BY id")).rows)).toBe(before)
  })
  it("a decided pair can be reopened with a reason, a merged one cannot, and counts reflect status", async () => {
    const id = await add("firm", "f1", "f2"); await decide(admin, id, "distinct")
    expect((await fail(reopen(admin, id, "short")))).toBeInstanceOf(ControlError)
    await reopen(admin, id, "Evidence changed, same website now")
    expect(await row(id)).toMatchObject({ status: "open", decided_by: null, parent_id: null })
    expect((await fail(reopen(admin, id, "Reopen an open one")))?.status).toBe(409)
    await db.query("UPDATE directory_candidates SET status = 'merged' WHERE id = $1", [id])
    expect((await fail(reopen(admin, id, "Reopen a merged pair")))?.status).toBe(409)
    expect((await counts()).some((c) => c.status === "merged")).toBe(true)
  })
  it("asks Anker to run detection through the relay, admins only, and audits the counts", async () => {
    state.body = { firms: { found: 12 }, people: { found: 3 } }
    expect((await fail(runDetectionNow(staff)))?.status).toBe(403)
    expect(await runDetectionNow(admin)).toEqual({ firms: 12, people: 3 })
    expect(state.calls[0]).toMatchObject({ path: "admin/directory-identity", method: "POST", staffEmail: "admin@sail.test" })
    state.status = 500; state.body = { error: "Detection failed." }
    expect((await fail(runDetectionNow(admin)))?.status).toBe(502)
  })
})

describe("merging from the queue (docs/architecture/55 E2 and E3)", () => {
  const sameId = async () => add("firm", `m${Math.random().toString(36).slice(2, 8)}a`, `m${Math.random().toString(36).slice(2, 8)}b`, "probable", 80).then(async (id) => { await db.query("UPDATE directory_candidates SET status = 'same' WHERE id = $1", [id]); return id })
  it("a preview asks Anker what a merge would do, changes nothing here, and reads out in plain words", async () => {
    const id = await sameId(), c = await row(id); state.body = { fills: { website: "x", bio: "y" }, conflicts: ["title"], moves: [{ table: "investors", column: "firm_id", n: 3, workspace: false }, { table: "crm_entries", column: "firm_id", n: 2, workspace: true }], drops: [{ table: "investor_matches", n: 4 }], workspaceRefs: 2, blockers: [], fillSkippedBecauseOfSource: false }
    const p = await planPair(admin, id, c.a_id); expect(state.calls[0]).toMatchObject({ path: "admin/directory-identity", method: "POST", staffEmail: "admin@sail.test" }); expect(JSON.parse(state.calls[0].body)).toEqual({ action: "plan", candidateId: id, survivorId: c.a_id })
    expect(describePlan(p)).toBe("Can be merged. Would fill empty fields: website, bio. Different values kept as the survivor's: title. Would move 5 reference(s) (2 in workspaces). Would remove 4 derived result row(s), regenerated by the next run.")
    expect(describePlan({ ...p, blockers: ["The surviving person is hidden or erased."] })).toMatch(/^Cannot merge: The surviving person is hidden/); expect((await row(id)).status).toBe("same")
  })
  it("a merge needs an admin and a pair confirmed as the same, is sent to Anker with the reason, and is audited with ids only", async () => {
    const id = await sameId(), c = await row(id), open = await add("firm", "o1", "o2")
    expect((await fail(mergePair(staff, id, c.a_id, "x")))?.status).toBe(403); expect((await fail(mergePair(admin, open, "o1", "x")))?.message).toMatch(/Confirm the pair as the same first/); expect((await fail(mergePair(admin, 999999, "o1", "x")))?.status).toBe(404)
    state.body = { mergeId: 7, moved: 3, filled: ["website"], conflicts: [] }; const r = await mergePair(admin, id, c.b_id, "Confirmed by reading both sites")
    expect(r.mergeId).toBe(7); expect(JSON.parse(state.calls.at(-1).body)).toEqual({ action: "merge", candidateId: id, survivorId: c.b_id, reason: "Confirmed by reading both sites" })
    const a = (await audits()).at(-1); expect(a).toMatchObject({ action: "platform.directory.merge", target: String(id) }); expect(a.detail).toMatchObject({ kind: "firm", survivor: c.b_id, loser: c.a_id, mergeId: 7, moved: 3 }); expect(JSON.stringify(a.detail)).not.toMatch(/Spring Capital|a@x\.com/)
  })
  it("Anker's refusal (a clash, a blocker, a missing reason) reaches the person in its own words and is not audited as done", async () => {
    const id = await sameId(), c = await row(id), before = (await audits()).length
    state.status = 409; state.body = { error: "A workspace holds a record for BOTH firms that cannot be combined automatically, so nothing was merged." }
    expect((await fail(mergePair(admin, id, c.a_id, "")))?.message).toMatch(/nothing was merged/); expect((await audits()).length).toBe(before)
  })
  it("undo needs an admin, a reason and a live merge; it asks Anker to put it back and audits ids and what was kept", async () => {
    const id = await sameId(); await db.exec("CREATE TABLE IF NOT EXISTS directory_merges (id bigserial PRIMARY KEY, candidate_id bigint, undo_until timestamptz, undone_at timestamptz)")
    expect((await fail(undoPair(admin, id, "long enough reason")))?.status).toBe(404); await db.query("INSERT INTO directory_merges (id, candidate_id, undo_until) VALUES (41, $1, now() + interval '90 days')", [id])
    expect(await mergeOf(id)).toMatchObject({ id: 41 }); expect((await fail(undoPair(staff, id, "long enough reason")))?.status).toBe(403); expect((await fail(undoPair(admin, id, "short")))?.message).toMatch(/reason/)
    state.body = { moved: 3, fieldsKept: ["bio"], derivedNotRestored: 2 }; const r = await undoPair(admin, id, "The two are different firms")
    expect(JSON.parse(state.calls.at(-1).body)).toEqual({ action: "undo", mergeId: 41 }); expect(r.fieldsKept).toEqual(["bio"]); expect((await audits()).at(-1)).toMatchObject({ action: "platform.directory.undo", detail: { mergeId: 41, fieldsKept: ["bio"] } })
  })
  it("applying a related pair as hierarchy needs an admin and goes through Anker", async () => {
    expect((await fail(applyHierarchy(staff, 1)))?.status).toBe(403); state.body = { ok: true, parentId: "f1", childId: "f2" }; await applyHierarchy(admin, 5)
    expect(JSON.parse(state.calls.at(-1).body)).toEqual({ action: "related", candidateId: 5 }); expect((await audits()).at(-1)).toMatchObject({ action: "platform.directory.hierarchy", detail: { parent: "f1", child: "f2" } })
  })
})
