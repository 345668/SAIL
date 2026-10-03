import { cookies } from "next/headers"
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto"
import { sql } from "./db"
import { SESSION_COOKIE } from "./constants"

/**
 * Company-portal auth — its OWN identity store (company_staff), fully separate
 * from tenant Supabase auth. Passwords are scrypt-hashed.
 *
 * Sessions are a signed cookie that names a row in `staff_sessions`. The row is
 * checked on EVERY request, so disabling an account or revoking a session takes
 * effect at once (the earlier stateless cookie stayed valid for its whole 8 hours).
 * A session is created by the password and is only usable once the second factor
 * (TOTP) has been verified: `getSession()` returns null until then, which gates
 * every page and API route without touching them. The MFA endpoints use
 * `getPartialSession()`.
 */

export { SESSION_COOKIE }
const SESSION_TTL_SECONDS = 8 * 60 * 60 // 8h — internal tool, short-lived

export interface StaffSession {
  id: string
  email: string
  name: string | null
  role: "staff" | "admin" | "superadmin"
}

/** A session as read from its server-side row. `sid` is the row id; `mfaVerified` says whether the second factor passed. */
export interface LiveSession extends StaffSession {
  sid: string
  mfaVerified: boolean
  mfaEnabled: boolean
}

// ── password hashing (scrypt) ───────────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, saltB64, hashB64] = stored.split("$")
    if (scheme !== "scrypt") return false
    const salt = Buffer.from(saltB64, "base64")
    const expected = Buffer.from(hashB64, "base64")
    const actual = scryptSync(password, salt, expected.length)
    return timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

// ── stateless session token (HMAC) ──────────────────────────────────────────
function secret(): string {
  const s = process.env.SECRET_KEY
  if (!s) throw new Error("SECRET_KEY is required for portal sessions")
  return s
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("base64url")
}

function makeToken(sid: string): string {
  const body = { sid, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }
  const payloadB64 = Buffer.from(JSON.stringify(body)).toString("base64url")
  return `${payloadB64}.${sign(payloadB64)}`
}

/** The session id a valid, unexpired cookie names, or null. Signature and expiry only: the database decides the rest. */
export function readToken(token: string): { sid: string } | null {
  const [payloadB64, sig] = token.split(".")
  if (!payloadB64 || !sig) return null
  const expected = sign(payloadB64)
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const body = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
    if (typeof body.exp !== "number" || body.exp < Math.floor(Date.now() / 1000)) return null
    return typeof body.sid === "string" && body.sid ? { sid: body.sid } : null
  } catch {
    return null
  }
}

// ── login / logout ──────────────────────────────────────────────────────────
export async function authenticate(email: string, password: string): Promise<StaffSession | null> {
  const rows = await sql`
    SELECT id, email, name, role, password_hash, disabled
    FROM company_staff WHERE lower(email) = lower(${email}) LIMIT 1`
  const row = rows[0] as any
  if (!row || row.disabled) return null
  if (!verifyPassword(password, row.password_hash)) return null
  await sql`UPDATE company_staff SET last_login_at = now() WHERE id = ${row.id}`
  return { id: row.id, email: row.email, name: row.name ?? null, role: row.role }
}

/** Create the server-side session row (not yet MFA-verified) and set the cookie. */
export async function startSession(session: StaffSession, meta: { ip?: string; userAgent?: string } = {}): Promise<string> {
  const rows = await sql`
    INSERT INTO staff_sessions (staff_id, expires_at, ip, user_agent)
    VALUES (${session.id}, now() + make_interval(secs => ${SESSION_TTL_SECONDS}), ${meta.ip ?? null}, ${(meta.userAgent ?? "").slice(0, 300) || null})
    RETURNING id` as any[]
  const sid = String(rows[0].id)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, makeToken(sid), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
  return sid
}

/** Revoke this browser's session row (and clear the cookie). */
export async function endSession(): Promise<void> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  const t = token ? readToken(token) : null
  if (t) { try { await sql`UPDATE staff_sessions SET revoked_at = now() WHERE id = ${t.sid} AND revoked_at IS NULL` } catch { /* cookie is cleared regardless */ } }
  jar.delete(SESSION_COOKIE)
}

/** Revoke every live session of a staff member (account compromise, offboarding). Returns how many. */
export async function revokeAllSessions(staffId: string): Promise<number> {
  const rows = await sql`UPDATE staff_sessions SET revoked_at = now() WHERE staff_id = ${staffId} AND revoked_at IS NULL RETURNING id` as any[]
  return rows.length
}

/** The session for this cookie if its row is live and its staff member is not disabled, whether or not MFA has passed. */
export async function getPartialSession(): Promise<LiveSession | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  const t = token ? readToken(token) : null
  if (!t) return null
  try {
    const rows = await sql`
      SELECT s.id AS sid, s.mfa_verified, s.last_seen_at, st.id, st.email, st.name, st.role,
             (m.enabled_at IS NOT NULL) AS mfa_enabled
      FROM staff_sessions s
      JOIN company_staff st ON st.id = s.staff_id
      LEFT JOIN staff_mfa m ON m.staff_id = st.id
      WHERE s.id = ${t.sid} AND s.revoked_at IS NULL AND s.expires_at > now() AND NOT st.disabled
      LIMIT 1` as any[]
    const r = rows[0]
    if (!r) return null
    if (Date.now() - new Date(r.last_seen_at).getTime() > 60_000) {
      try { await sql`UPDATE staff_sessions SET last_seen_at = now() WHERE id = ${t.sid}` } catch { /* best effort */ }
    }
    return { sid: r.sid, id: r.id, email: r.email, name: r.name ?? null, role: r.role, mfaVerified: !!r.mfa_verified, mfaEnabled: !!r.mfa_enabled }
  } catch {
    return null   // an unreadable session store means no session, never an open door
  }
}

/** Mark a session's second factor as verified. */
export async function markMfaVerified(sid: string): Promise<void> {
  await sql`UPDATE staff_sessions SET mfa_verified = true WHERE id = ${sid}`
}

/** Read the current staff session (server components / route handlers). Null until the password AND second factor passed. */
export async function getSession(): Promise<StaffSession | null> {
  const s = await getPartialSession()
  if (!s || !s.mfaVerified) return null
  return { id: s.id, email: s.email, name: s.name, role: s.role }
}

/** Lightweight check for middleware (Edge) — signature + expiry only, no DB. */
export function verifySessionToken(token: string | undefined): boolean {
  return !!token && readToken(token) !== null
}
