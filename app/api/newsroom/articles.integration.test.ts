import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"

const state = vi.hoisted(() => ({ q: null as any, session: { id: "s1", email: "ed@sail.test", role: "admin" } as any }))
vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
import { GET as list, POST as create } from "./route"
import { GET as one, PATCH as patch } from "./[id]/route"

let db: PGlite
/** The production table, column for column (the tenant app owns it): the subtitle is `executive_summary`, there is no `subheadline`. */
const TABLE = `CREATE TABLE news_articles (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid()::text, slug varchar NOT NULL, headline varchar NOT NULL, executive_summary text, content text NOT NULL,
  author varchar DEFAULT 'Anker Intelligence', blog_type varchar DEFAULT 'Insights', image_url varchar, tags text[] DEFAULT '{}', sources jsonb DEFAULT '[]',
  confidence_score real DEFAULT 0, ai_model varchar DEFAULT 'mistral', status varchar DEFAULT 'draft', published_at timestamp, scheduled_for timestamp,
  scheduled_slot varchar, view_count integer DEFAULT 0, source_item_ids text[] DEFAULT '{}', created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now(),
  source_type varchar DEFAULT 'ai', source_pdf_url text, created_by text, sentiment text)`
const json = (body: unknown, method = "POST") => new Request("https://sail.test/api/newsroom", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(TABLE)
  await db.exec("CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now())")
}, 30000)
beforeEach(() => db.exec("DELETE FROM news_articles; DELETE FROM company_audit_log"))

describe("saving and reading newsroom articles against the real table", () => {
  it("creates an article: the subtitle goes to executive_summary and comes back as subheadline", async () => {
    const r = await create(json({ headline: "Funds raised less", subheadline: "LPs paused in the second half", content: "## Body", tags: ["funds"], ai_model: "qwen3.7-plus" }))
    const j = await r.json()
    expect(r.status, JSON.stringify(j)).toBe(201)
    expect(j.article.subheadline).toBe("LPs paused in the second half")
    const row = (await db.query("SELECT executive_summary, ai_model, content FROM news_articles")).rows[0] as any
    expect(row).toMatchObject({ executive_summary: "LPs paused in the second half", ai_model: "qwen3.7-plus", content: "## Body" })
  })
  it("records a hand-written piece as manual, not as the column's old default, and accepts an empty body", async () => {
    const r = await create(json({ headline: "Notes", content: null }))
    expect(r.status).toBe(201)
    const row = (await db.query("SELECT ai_model, content, executive_summary FROM news_articles")).rows[0] as any
    expect(row).toMatchObject({ ai_model: "manual", content: "", executive_summary: null })
  })
  it("lists articles with their subtitle and finds them by it", async () => {
    await create(json({ headline: "One", subheadline: "Deal flow slows", content: "x" }))
    await create(json({ headline: "Two", subheadline: "Secondaries grow", content: "y" }))
    const all = await (await list(new Request("https://sail.test/api/newsroom"))).json()
    expect(all.articles.map((a: any) => a.subheadline).sort()).toEqual(["Deal flow slows", "Secondaries grow"])
    const hit = await (await list(new Request("https://sail.test/api/newsroom?q=secondaries"))).json()
    expect(hit.articles).toHaveLength(1)
    expect(hit.articles[0].headline).toBe("Two")
    const filtered = await (await list(new Request("https://sail.test/api/newsroom?q=slows&status=draft&blogType=Insights"))).json()
    expect(filtered.articles.map((a: any) => a.headline)).toEqual(["One"])
  })
  it("reads one article and updates its subtitle and content", async () => {
    const id = (await (await create(json({ headline: "Edit me", subheadline: "Before", content: "old" }))).json()).article.id
    expect((await (await one(new Request("https://sail.test/x"), ctx(id))).json()).article.subheadline).toBe("Before")
    const r = await patch(json({ subheadline: "After", content: null }, "PATCH"), ctx(id))
    const j = await r.json()
    expect(r.status, JSON.stringify(j)).toBe(200)
    expect(j.article.subheadline).toBe("After")
    const row = (await db.query("SELECT executive_summary, content FROM news_articles WHERE id=$1", [id])).rows[0] as any
    expect(row).toMatchObject({ executive_summary: "After", content: "" })
  })
  it("never refers to a column called subheadline, which the table does not have", () => {
    for (const f of ["app/api/newsroom/route.ts", "app/api/newsroom/[id]/route.ts", "app/(portal)/newsroom/page.tsx", "app/(portal)/newsroom/[id]/page.tsx"]) {
      const src = readFileSync(f, "utf8")
      expect(src, f).not.toMatch(/\bOR subheadline\b|SET subheadline\b|\(headline, subheadline\b|SELECT \* FROM news_articles/)
    }
  })
})
