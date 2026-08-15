import { cookies } from "next/headers"
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto"
import { sql } from "./db"
import { SESSION_COOKIE } from "./constants"

/**
 * Company-portal auth — its OWN identity store (company_staff), fully separate
 * from tenant Supabase auth. Passwords are scrypt-hashed; sessions are stateless
 * HMAC-signed cookies keyed by SECRET_KEY.
 */

export { SESSION_COOKIE }
const SESSION_TTL_SECONDS = 8 * 60 * 60 // 8h — internal tool, short-lived

export interface StaffSession {
  id: string
  email: string
  name: string | null
  role: "staff" | "admin" | "superadmin"
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

function makeToken(session: StaffSession): string {
  const body = { ...session, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }
  const payloadB64 = Buffer.from(JSON.stringify(body)).toString("base64url")
  return `${payloadB64}.${sign(payloadB64)}`
}

function readToken(token: string): StaffSession | null {
  const [payloadB64, sig] = token.split(".")
  if (!payloadB64 || !sig) return null
  const expected = sign(payloadB64)
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  try {
    const body = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"))
    if (typeof body.exp !== "number" || body.exp < Math.floor(Date.now() / 1000)) return null
    return { id: body.id, email: body.email, name: body.name ?? null, role: body.role }
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

export async function startSession(session: StaffSession): Promise<void> {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, makeToken(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function endSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}

/** Read the current staff session (server components / route handlers). */
export async function getSession(): Promise<StaffSession | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  return token ? readToken(token) : null
}

/** Lightweight check for middleware (Edge) — signature + expiry only, no DB. */
export function verifySessionToken(token: string | undefined): boolean {
  return !!token && readToken(token) !== null
}
