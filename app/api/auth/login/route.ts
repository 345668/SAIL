import { NextResponse } from "next/server"
import { authenticate, startSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { audit } from "@/lib/audit"
import { checkLock, clientIp, recordAttempt } from "@/lib/login-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Step one of sign-in: the password. It never grants access by itself. It creates a server-side session that is unusable
 * until the second factor passes, and tells the page which step comes next: `enroll` (no authenticator yet: set one up) or
 * `verify` (enter the code). Wrong passwords are counted and, past the limit, locked out; every failure is audited.
 */
export async function POST(req: Request) {
  let email = "", password = ""
  try {
    const body = await req.json()
    email = String(body.email || "").trim()
    password = String(body.password || "")
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }
  if (!email || !password) return NextResponse.json({ error: "Email and password required" }, { status: 400 })

  const ip = clientIp(req)
  const lock = await checkLock(email, ip)
  if (lock.locked) {
    await audit("auth.login_locked", { email }, null, { ip })
    return NextResponse.json({ error: `Too many attempts. Try again in ${lock.retryAfterMin} minutes.` }, { status: 429, headers: { "Retry-After": String(lock.retryAfterMin * 60) } })
  }

  const session = await authenticate(email, password)
  if (!session) {
    await recordAttempt(email, ip, false)
    await audit("auth.login_failed", { email }, null, { ip })
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }
  await recordAttempt(email, ip, true)
  await startSession(session, { ip, userAgent: req.headers.get("user-agent") || "" })
  await audit("auth.password_ok", session, null, { ip })
  const mfa = (await sql`SELECT 1 FROM staff_mfa WHERE staff_id = ${session.id} AND enabled_at IS NOT NULL`) as any[]
  return NextResponse.json({ ok: true, next: mfa.length ? "verify" : "enroll" })
}
