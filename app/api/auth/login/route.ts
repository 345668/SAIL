import { NextResponse } from "next/server"
import { authenticate, startSession } from "@/lib/auth"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: Request) {
  let email = "", password = ""
  try {
    const body = await req.json()
    email = String(body.email || "").trim()
    password = String(body.password || "")
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 })
  }
  const session = await authenticate(email, password)
  if (!session) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 })
  }
  await startSession(session)
  // Best-effort audit — never block sign-in on a logging failure.
  try {
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action) VALUES (${session.id}, ${session.email}, 'auth.login')`
  } catch { /* ignore */ }
  return NextResponse.json({ ok: true })
}
