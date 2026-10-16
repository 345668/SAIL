import { describe, it, expect, vi, beforeAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"

const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
import { listSources, reviewSource, withdrawSource, restoreSource, WITHDRAW_ADMIN_CEILING } from "./directory-sources"
import { ControlError } from "./tenant-control"

let db: PGlite
const admin = { id: "a1", email: "admin@sail.test", role: "admin" as const }
const staff = { id: "s1", email: "staff@sail.test", role: "staff" as const }
const root = { id: "r1", email: "root@sail.test", role: "superadmin" as const }
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as ControlError)
const why = "Supplier contract reviewed, ticket 12"
const row = async (s: string) => (await db.query("SELECT * FROM directory_sources WHERE source = $1", [s])).rows[0] as any
const base = { kind: "partner_list", licenceSummary: "Written agreement", permittedUse: ["internal_matching", "outreach_email"], reason: why }

beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE investors (id serial PRIMARY KEY, source text); CREATE TABLE investment_firms (id serial PRIMARY KEY, source text);
    CREATE TABLE directory_sources (source text PRIMARY KEY, label text, kind text NOT NULL DEFAULT 'unknown', acquired_at date, supplier text, licence_summary text, permitted_use text[] NOT NULL DEFAULT '{}', forbidden_use text, lawful_basis_note text,
      notice_status text NOT NULL DEFAULT 'pending', status text NOT NULL DEFAULT 'unreviewed', evidence_ref text, reviewed_by text, reviewed_at timestamptz, withdrawn_at timestamptz, withdraw_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO directory_sources (source, permitted_use) VALUES ('folk', ARRAY['internal_matching']), ('big', ARRAY['internal_matching']);
    INSERT INTO investors (source) SELECT 'folk' FROM generate_series(1, 3); INSERT INTO investors (source) SELECT 'big' FROM generate_series(1, ${WITHDRAW_ADMIN_CEILING + 1}); INSERT INTO investment_firms (source) VALUES ('folk');`)
}, 30000)
const audits = async () => (await db.query("SELECT action, target, detail FROM company_audit_log ORDER BY id")).rows as any[]

describe("directory sources", () => {
  it("lists sources with their people and firms counts, unreviewed first", async () => {
    const l = await listSources()
    expect(l.find((s) => s.source === "folk")).toMatchObject({ people: 3, firms: 1, status: "unreviewed" })
  })
  it("only admins review; a reason is required", async () => {
    expect((await fail(reviewSource(staff, { source: "folk", status: "recorded", ...base })))?.status).toBe(403)
    expect(await fail(reviewSource(admin, { source: "folk", status: "recorded", ...base, reason: "short" }))).toBeInstanceOf(ControlError)
    expect((await row("folk")).status).toBe("unreviewed")
  })
  it("a recorded source needs a licence and a use; a restricted one needs a note of what is not allowed", async () => {
    expect((await fail(reviewSource(admin, { source: "folk", status: "recorded", ...base, licenceSummary: "" })))?.message).toMatch(/licence summary/)
    expect((await fail(reviewSource(admin, { source: "folk", status: "recorded", ...base, permittedUse: [] })))?.message).toMatch(/permitted use/)
    expect((await fail(reviewSource(admin, { source: "folk", status: "restricted", ...base })))?.message).toMatch(/what is not allowed/)
    expect((await fail(reviewSource(admin, { source: "folk", status: "recorded", ...base, permittedUse: ["spam"] })))?.message).toMatch(/Unknown permitted use/)
  })
  it("records a review and audits before and after; registers a new source", async () => {
    await reviewSource(admin, { source: "folk", status: "recorded", ...base })
    expect(await row("folk")).toMatchObject({ status: "recorded", permitted_use: ["internal_matching", "outreach_email"], reviewed_by: "admin@sail.test" })
    await reviewSource(admin, { source: "csv:new-2026", status: "recorded", ...base })
    expect((await row("csv:new-2026")).status).toBe("recorded")
    const a = (await audits()).filter((x) => x.action === "platform.directory_source.review")
    expect(a[0].detail).toMatchObject({ from: { status: "unreviewed" }, to: { status: "recorded" }, reason: why })
  })
  it("an unreviewed source keeps matching as its only use", async () => {
    await reviewSource(admin, { source: "folk", status: "unreviewed", ...base })
    expect((await row("folk")).permitted_use).toEqual(["internal_matching"])
    await reviewSource(admin, { source: "folk", status: "recorded", ...base })
  })
  it("withdraws a source with a reason, audits it, and refuses a review of a withdrawn source until restored", async () => {
    expect(await withdrawSource(admin, "folk", why)).toEqual({ people: 3, firms: 1 })
    expect(await row("folk")).toMatchObject({ status: "withdrawn", withdraw_reason: why })
    expect((await audits()).find((x) => x.action === "platform.directory_source.withdraw")).toMatchObject({ target: "folk", detail: { people: 3, firms: 1 } })
    expect((await fail(withdrawSource(admin, "folk", why)))?.message).toMatch(/Already withdrawn/)
    expect((await fail(reviewSource(admin, { source: "folk", status: "recorded", ...base })))?.message).toMatch(/Restore it first/)
    await restoreSource(admin, "folk", why)
    expect(await row("folk")).toMatchObject({ status: "unreviewed", withdraw_reason: null, permitted_use: ["internal_matching"] })
    expect((await fail(restoreSource(admin, "folk", why)))?.message).toMatch(/Only a withdrawn/)
  })
  it("withdrawing more than the ceiling needs a superadmin", async () => {
    expect((await fail(withdrawSource(admin, "big", why)))?.status).toBe(403)
    expect((await row("big")).status).toBe("unreviewed")
    expect((await withdrawSource(root, "big", why)).people).toBe(WITHDRAW_ADMIN_CEILING + 1)
  })
  it("staff cannot withdraw or restore; an unknown source is a 404", async () => {
    expect((await fail(withdrawSource(staff, "folk", why)))?.status).toBe(403)
    expect((await fail(restoreSource(staff, "big", why)))?.status).toBe(403)
    expect((await fail(withdrawSource(admin, "nope", why)))?.status).toBe(404)
  })
})
