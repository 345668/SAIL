import { describe, it, expect, vi, beforeEach } from "vitest"

const jar = vi.hoisted(() => ({ store: new Map<string, string>(), set: [] as any[] }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.store.has(k) ? { value: jar.store.get(k) } : undefined),
    set: (k: string, v: string, o: any) => { jar.store.set(k, v); jar.set.push({ k, v, o }) },
    delete: (k: string) => { jar.store.delete(k) },
  }),
}))
const db = vi.hoisted(() => ({ calls: [] as { q: string; v: any[] }[], next: [] as any[][] }))
vi.mock("./db", () => ({
  sql: async (strings: TemplateStringsArray, ...v: any[]) => { db.calls.push({ q: strings.join("?"), v }); return db.next.shift() ?? [] },
}))
process.env.SECRET_KEY = "test-secret"
import { readToken, startSession, endSession, getPartialSession, getSession, markMfaVerified, revokeAllSessions, verifySessionToken, SESSION_COOKIE } from "./auth"

const staff = { id: "u1", email: "a@an-ker.de", name: "A", role: "admin" as const }
beforeEach(() => { jar.store.clear(); jar.set = []; db.calls = []; db.next = [] })

describe("the session cookie", () => {
  it("names a server-side session and carries no identity of its own", async () => {
    db.next = [[{ id: "sid-1" }]]
    const sid = await startSession(staff, { ip: "1.2.3.4", userAgent: "UA" })
    expect(sid).toBe("sid-1")
    const token = jar.store.get(SESSION_COOKIE)!
    expect(readToken(token)).toEqual({ sid: "sid-1" })
    expect(Buffer.from(token.split(".")[0], "base64url").toString()).not.toContain("a@an-ker.de")
    expect(jar.set[0].o).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" })
  })
  it("rejects a tampered, truncated or expired cookie, and an old-style cookie with no session id", () => {
    db.next = [[{ id: "sid-1" }]]
    return startSession(staff).then(() => {
      const [p, s] = jar.store.get(SESSION_COOKIE)!.split(".")
      expect(readToken(`${p}.${s.slice(0, -2)}xx`)).toBeNull()
      expect(readToken("garbage")).toBeNull()
      const old = Buffer.from(JSON.stringify({ id: "u1", email: "a@an-ker.de", role: "admin", exp: 9999999999 })).toString("base64url")
      expect(readToken(`${old}.whatever`)).toBeNull()
      expect(verifySessionToken(jar.store.get(SESSION_COOKIE))).toBe(true)
      expect(verifySessionToken(undefined)).toBe(false)
    })
  })
})

describe("what makes a session live", () => {
  const live = { sid: "sid-1", mfa_verified: false, last_seen_at: new Date().toISOString(), id: "u1", email: "a@an-ker.de", name: "A", role: "admin", mfa_enabled: true }
  const withCookie = async () => { db.next = [[{ id: "sid-1" }]]; await startSession(staff); db.calls = [] }

  it("is asked of the database on every request: not revoked, not expired, staff not disabled", async () => {
    await withCookie()
    db.next = [[live]]
    await getPartialSession()
    const q = db.calls[0].q
    expect(q).toContain("s.revoked_at IS NULL")
    expect(q).toContain("s.expires_at > now()")
    expect(q).toContain("NOT st.disabled")
  })
  it("is null when the row is gone, revoked or the account disabled (the query returns nothing)", async () => {
    await withCookie()
    db.next = [[]]
    expect(await getPartialSession()).toBeNull()
  })
  it("is null with no cookie, and never reads the database for it", async () => {
    expect(await getPartialSession()).toBeNull()
    expect(db.calls).toHaveLength(0)
  })
  it("fails closed when the session store cannot be read", async () => {
    await withCookie()
    vi.resetModules()
    db.next = []
    const orig = db.next
    ;(db as any).next = { shift: () => { throw new Error("db down") } }
    expect(await getPartialSession()).toBeNull()
    ;(db as any).next = orig
  })
  it("getSession stays null until the second factor has passed, then opens", async () => {
    await withCookie()
    db.next = [[{ ...live, mfa_verified: false }]]
    expect(await getSession()).toBeNull()
    db.next = [[{ ...live, mfa_verified: true }]]
    expect(await getSession()).toEqual({ id: "u1", email: "a@an-ker.de", name: "A", role: "admin" })
  })
  it("a partial session reports whether the account has two-factor, so the page knows which step is next", async () => {
    await withCookie()
    db.next = [[{ ...live, mfa_enabled: false }]]
    expect(await getPartialSession()).toMatchObject({ mfaVerified: false, mfaEnabled: false })
  })
})

describe("ending and revoking", () => {
  it("logout revokes the row and clears the cookie", async () => {
    db.next = [[{ id: "sid-1" }]]
    await startSession(staff)
    db.calls = []
    await endSession()
    expect(db.calls[0].q).toContain("SET revoked_at = now()")
    expect(db.calls[0].v).toContain("sid-1")
    expect(jar.store.has(SESSION_COOKIE)).toBe(false)
  })
  it("revokes every live session of a staff member and says how many", async () => {
    db.next = [[{ id: "a" }, { id: "b" }]]
    expect(await revokeAllSessions("u1")).toBe(2)
    expect(db.calls[0].q).toContain("revoked_at IS NULL")
  })
  it("marks the second factor verified on the session row", async () => {
    await markMfaVerified("sid-1")
    expect(db.calls[0].q).toContain("SET mfa_verified = true")
  })
})
