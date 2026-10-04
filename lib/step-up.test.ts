import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"

const state = vi.hoisted(() => ({ q: null as any }))
vi.mock("@/lib/db", () => ({ sql: (p: TemplateStringsArray, ...v: unknown[]) => state.q(p.reduce((q, s, i) => q + (i ? `$${i}` : "") + s, ""), v) }))
process.env.SECRET_KEY = "stepup-test-secret"
import { requireStepUp, StepUpError } from "./step-up"
import { encryptSecret } from "./crypto"
import { generateSecret, totpAt, stepOf } from "./totp"

let db: PGlite
const staff = { id: "s1", email: "root@sail.test" }
const secret = generateSecret()
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as StepUpError)

beforeAll(async () => {
  db = new PGlite()
  state.q = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`CREATE TABLE company_staff (id text PRIMARY KEY, email text UNIQUE, name text, password_hash text, role text, disabled boolean, last_login_at timestamptz);
    CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());`)
  await db.exec(readFileSync("db/002-staff-security.sql", "utf8"))
}, 30000)
beforeEach(async () => {
  await db.exec("DELETE FROM staff_mfa; DELETE FROM staff_login_attempts; DELETE FROM company_audit_log; DELETE FROM company_staff")
  await db.exec("INSERT INTO company_staff (id, email, name, password_hash, role, disabled) VALUES ('s1', 'root@sail.test', 'Root', 'x', 'superadmin', false)")
  await db.query("INSERT INTO staff_mfa (staff_id, secret_enc, backup_hashes, enabled_at, last_used_step) VALUES ('s1', $1, '{}', now(), NULL)", [encryptSecret(secret)])
})

describe("step-up two-factor", () => {
  it("accepts a current code once, audits it, and refuses the same code again", async () => {
    const code = totpAt(secret, Date.now())
    await expect(requireStepUp(staff, code, "1.1.1.1", "erasure")).resolves.toBeUndefined()
    expect((await db.query("SELECT action FROM company_audit_log")).rows).toEqual([{ action: "auth.stepup" }])
    expect((await fail(requireStepUp(staff, code, "1.1.1.1", "erasure")))?.message).toMatch(/already used/)
  })
  it("a code that was used at sign-in cannot be reused for a step-up: it needs the next one", async () => {
    await db.query("UPDATE staff_mfa SET last_used_step = $1", [stepOf(Date.now())])
    expect((await fail(requireStepUp(staff, totpAt(secret, Date.now()))))?.status).toBe(401)
    await expect(requireStepUp(staff, totpAt(secret, Date.now() + 30_000))).resolves.toBeUndefined()
  })
  it("refuses a wrong code, a malformed one and a recovery code, and repeated failures lock the account", async () => {
    for (const bad of ["000000", "abc", "", "ABCDE-12345", "111111"]) expect((await fail(requireStepUp(staff, bad, "2.2.2.2")))?.status).toBe(401)
    expect((await fail(requireStepUp(staff, totpAt(secret, Date.now()), "2.2.2.2")))?.status).toBe(429)
    expect((await db.query("SELECT count(*)::int n FROM company_audit_log WHERE action = 'auth.stepup_failed'")).rows[0]).toEqual({ n: 5 })
  })
  it("a person with no two-factor set up cannot step up", async () => {
    await db.exec("DELETE FROM staff_mfa")
    expect((await fail(requireStepUp(staff, "123456")))?.status).toBe(409)
  })
})
