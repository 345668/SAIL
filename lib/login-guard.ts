/**
 * Sign-in lockout. A password or one-time code that is guessed wrongly too often locks that account (and, separately,
 * that address) for a window, whatever the next guess is. Counted in the database so it holds across serverless
 * instances; nothing here depends on process memory.
 */
import { sql } from "./db"

export const MAX_FAILS_PER_EMAIL = 5
export const MAX_FAILS_PER_IP = 25
export const WINDOW_MINUTES = 15

/** Pure: given the failure counts in the window, is sign-in refused? */
export function isLockedOut(failsForEmail: number, failsForIp: number): boolean {
  return failsForEmail >= MAX_FAILS_PER_EMAIL || failsForIp >= MAX_FAILS_PER_IP
}

export async function checkLock(email: string, ip: string): Promise<{ locked: boolean; retryAfterMin: number }> {
  const e = email.trim().toLowerCase()
  try {
    // Failures since the account's last success: a correct sign-in clears the slate.
    const byEmail = (await sql`
      SELECT count(*)::int AS n FROM staff_login_attempts
      WHERE lower(email) = ${e} AND NOT ok AND at > now() - make_interval(mins => ${WINDOW_MINUTES})
        AND at > coalesce((SELECT max(at) FROM staff_login_attempts WHERE lower(email) = ${e} AND ok), 'epoch'::timestamptz)`) as any[]
    const byIp = (await sql`
      SELECT count(*)::int AS n FROM staff_login_attempts
      WHERE ip = ${ip} AND NOT ok AND at > now() - make_interval(mins => ${WINDOW_MINUTES})`) as any[]
    const locked = isLockedOut(Number(byEmail[0]?.n ?? 0), Number(byIp[0]?.n ?? 0))
    return { locked, retryAfterMin: locked ? WINDOW_MINUTES : 0 }
  } catch {
    // If the guard cannot read its table, fail CLOSED for sign-in: a broken lockout must not become no lockout.
    return { locked: true, retryAfterMin: 1 }
  }
}

export async function recordAttempt(email: string, ip: string, ok: boolean, kind: "password" | "mfa" = "password"): Promise<void> {
  try {
    await sql`INSERT INTO staff_login_attempts (email, ip, ok, kind) VALUES (${email.trim().toLowerCase()}, ${ip}, ${ok}, ${kind})`
  } catch { /* the audit write below still records a failure */ }
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown"
}
