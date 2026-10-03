/**
 * The whole staff sign-in flow, through the real route handlers, against a real Postgres (PGlite) with the real
 * 002-staff-security.sql applied. Mocks only the cookie jar. This is the test that matters before shipping a change to how
 * the only admin gets in: it covers the SQL as written (make_interval, ON CONFLICT, array_remove, conditional UPDATE),
 * not a mock of it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { readFileSync } from "node:fs"

const jar = vi.hoisted(() => ({ store: new Map<string, string>() }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.store.has(k) ? { value: jar.store.get(k) } : undefined),
    set: (k: string, v: string) => { jar.store.set(k, v) },
    delete: (k: string) => { jar.store.delete(k) },
  }),
}))
const state = vi.hoisted(() => ({ query: null as any }))
vi.mock("@/lib/db", () => ({
  sql: (parts: TemplateStringsArray, ...values: unknown[]) => state.query(parts.reduce((q, p, i) => q + (i ? `$${i}` : "") + p, ""), values),
}))
process.env.SECRET_KEY = "flow-test-secret"

import { hashPassword, getSession, getPartialSession, endSession, revokeAllSessions } from "@/lib/auth"
import { totpAt } from "@/lib/totp"
import { POST as login } from "./login/route"
import { POST as setup } from "./mfa/setup/route"
import { POST as enable } from "./mfa/enable/route"
import { POST as verify } from "./mfa/verify/route"
import { POST as logout } from "./logout/route"

let db: PGlite
const json = async (res: Response) => ({ status: res.status, body: await res.json() })
const req = (body: unknown, ip = "9.9.9.9") => new Request("https://sail.test/x", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip, "user-agent": "vitest" }, body: JSON.stringify(body) })
const PASSWORD = "correct horse battery staple"

beforeAll(async () => {
  db = new PGlite()
  state.query = async (q: string, v: unknown[] = []) => (await db.query(q, v)).rows
  await db.exec(`
    CREATE TABLE company_staff (id text PRIMARY KEY DEFAULT gen_random_uuid()::text, email text NOT NULL UNIQUE, name text, password_hash text NOT NULL,
      role text NOT NULL DEFAULT 'staff', disabled boolean NOT NULL DEFAULT false, last_login_at timestamptz);
    CREATE TABLE company_audit_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, staff_id text, staff_email text, action text NOT NULL, target text, detail jsonb, created_at timestamptz NOT NULL DEFAULT now());`)
  const mig = readFileSync("db/002-staff-security.sql", "utf8")
  await db.exec(mig); await db.exec(mig)          // applied twice: the migration must be idempotent
}, 60000)
afterAll(async () => { await db.close() })

beforeEach(async () => {
  jar.store.clear()
  await db.exec("DELETE FROM staff_login_attempts; DELETE FROM staff_sessions; DELETE FROM staff_mfa; DELETE FROM company_audit_log; DELETE FROM company_staff;")
  await db.query("INSERT INTO company_staff (id, email, name, password_hash, role) VALUES ('u1', 'admin@an-ker.de', 'Admin', $1, 'admin')", [hashPassword(PASSWORD)])
})

const actions = async () => (await db.query("SELECT action FROM company_audit_log ORDER BY id")).rows.map((r: any) => r.action)

async function enrol() {
  expect((await json(await login(req({ email: "admin@an-ker.de", password: PASSWORD })))).body).toMatchObject({ ok: true, next: "enroll" })
  const { body: s } = await json(await setup())
  const code = totpAt(s.secret, Date.now())
  const { status, body } = await json(await enable(req({ code })))
  expect(status).toBe(200)
  return { secret: s.secret as string, backup: body.backupCodes as string[] }
}

describe("first sign-in: enrolment", () => {
  it("a password alone opens nothing; the session only becomes usable after the first authenticator code", async () => {
    await json(await login(req({ email: "admin@an-ker.de", password: PASSWORD })))
    expect(await getSession()).toBeNull()                         // password accepted, second factor not done
    expect((await getPartialSession())?.mfaVerified).toBe(false)
    const { body: s } = await json(await setup())
    expect(s.secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(s.uri).toContain("otpauth://totp/")
    expect((await json(await enable(req({ code: "000000" })))).status).toBe(401)
    expect(await getSession()).toBeNull()                         // a wrong code does not open it
    const ok = await json(await enable(req({ code: totpAt(s.secret, Date.now()) })))
    expect(ok.status).toBe(200)
    expect(ok.body.backupCodes).toHaveLength(10)
    expect(await getSession()).toMatchObject({ email: "admin@an-ker.de", role: "admin" })
    expect(await actions()).toEqual(expect.arrayContaining(["auth.password_ok", "auth.mfa_setup_started", "auth.mfa_enable_failed", "auth.mfa_enabled", "auth.login"]))
  })
  it("stores the secret encrypted, never in the clear", async () => {
    const { secret } = await enrol()
    const [row] = (await db.query("SELECT secret_enc FROM staff_mfa")).rows as any[]
    expect(row.secret_enc).toMatch(/^gcm\$/)
    expect(row.secret_enc).not.toContain(secret)
  })
  it("cannot enrol twice", async () => {
    await enrol()
    expect((await json(await setup())).status).toBe(409)
  })
})

describe("later sign-ins: the code", () => {
  async function signInAgain(secretCode: (s: string) => string, secret: string) {
    jar.store.clear()
    expect((await json(await login(req({ email: "admin@an-ker.de", password: PASSWORD })))).body.next).toBe("verify")
    return json(await verify(req({ code: secretCode(secret) })))
  }
  it("opens with a valid code", async () => {
    const { secret } = await enrol()
    // a later time step than the one used at enrolment, so the replay rule does not apply
    const r = await signInAgain((s) => totpAt(s, Date.now() + 30_000), secret)
    expect(r.status).toBe(200)
    expect(await getSession()).not.toBeNull()
  })
  it("refuses a code whose time step was already used (no replay)", async () => {
    const { secret } = await enrol()
    const r = await signInAgain((s) => totpAt(s, Date.now()), secret)     // same step as the enrolment code
    expect(r.status).toBe(401)
    expect(await getSession()).toBeNull()
  })
  it("accepts a recovery code once and only once", async () => {
    const { backup } = await enrol()
    jar.store.clear()
    await login(req({ email: "admin@an-ker.de", password: PASSWORD }))
    expect((await json(await verify(req({ code: backup[0] })))).status).toBe(200)
    expect(await actions()).toContain("auth.backup_code_used")
    jar.store.clear()
    await login(req({ email: "admin@an-ker.de", password: PASSWORD }))
    expect((await json(await verify(req({ code: backup[0] })))).status).toBe(401)      // spent
    expect((await json(await verify(req({ code: backup[1] })))).status).toBe(200)      // another still works
  })
})

describe("lockout", () => {
  it("locks the account after five wrong passwords, even for the right one, and audits it", async () => {
    for (let i = 0; i < 5; i++) expect((await json(await login(req({ email: "admin@an-ker.de", password: "wrong" })))).status).toBe(401)
    const locked = await json(await login(req({ email: "admin@an-ker.de", password: PASSWORD })))
    expect(locked.status).toBe(429)
    expect(await actions()).toEqual(expect.arrayContaining(["auth.login_failed", "auth.login_locked"]))
  })
  it("counts wrong authenticator codes toward the same lockout", async () => {
    await enrol()
    jar.store.clear()
    await login(req({ email: "admin@an-ker.de", password: PASSWORD }))
    for (let i = 0; i < 5; i++) await verify(req({ code: "111111" }))
    expect((await json(await verify(req({ code: "222222" })))).status).toBe(429)
  })
  it("treats an unknown email like a wrong password (no account enumeration) and still counts it", async () => {
    const r = await json(await login(req({ email: "nobody@an-ker.de", password: "x" })))
    expect(r.status).toBe(401)
    expect(r.body.error).toBe("Invalid credentials")
    expect(Number(((await db.query("SELECT count(*)::int n FROM staff_login_attempts WHERE NOT ok")).rows[0] as any).n)).toBe(1)
  })
})

describe("revocation and disabling take effect at once", () => {
  it("logout revokes the session on the server", async () => {
    await enrol()
    const cookie = [...jar.store.values()][0]
    await logout()
    jar.store.set("anker_company_session", cookie)              // the old cookie, replayed
    expect(await getSession()).toBeNull()
  })
  it("revoking all of a staff member's sessions ends the live one", async () => {
    await enrol()
    expect(await getSession()).not.toBeNull()
    expect(await revokeAllSessions("u1")).toBeGreaterThanOrEqual(1)
    expect(await getSession()).toBeNull()
  })
  it("disabling the account ends a live session without waiting for it to expire", async () => {
    await enrol()
    expect(await getSession()).not.toBeNull()
    await db.exec("UPDATE company_staff SET disabled = true WHERE id = 'u1'")
    expect(await getSession()).toBeNull()
  })
  it("an expired session is refused", async () => {
    await enrol()
    await db.exec("UPDATE staff_sessions SET expires_at = now() - interval '1 minute'")
    expect(await getSession()).toBeNull()
  })
})
