import { NextResponse } from "next/server"
import { createHash, randomBytes } from "crypto"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Mint a single-use, short-lived impersonation grant so a staffer can open the
 * tenant Venture OS "as" a given org. We store only the SHA-256 of the opaque
 * token; the raw token travels once, in the hand-off URL. The tenant app's
 * /api/impersonate/accept endpoint (phase 2) validates + consumes it, scopes a
 * session to the org, and shows a persistent "viewing as" banner.
 */
export async function POST(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let orgId = "", mode = "readonly"
  try {
    const body = await req.json()
    orgId = String(body.orgId || "").trim()
    mode = body.mode === "full" ? "full" : "readonly"
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 })

  const token = randomBytes(32).toString("base64url")
  const tokenHash = createHash("sha256").update(token).digest("hex")
  const expires = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes to redeem

  await sql`
    INSERT INTO impersonation_grants (staff_id, staff_email, org_id, mode, token_hash, expires_at)
    VALUES (${staff.id}, ${staff.email}, ${orgId}, ${mode}, ${tokenHash}, ${expires.toISOString()})`

  try {
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'impersonate.mint', ${orgId}, ${JSON.stringify({ mode })})`
  } catch { /* ignore */ }

  const tenant = process.env.TENANT_APP_URL || "http://localhost:3000"
  const url = `${tenant.replace(/\/$/, "")}/api/impersonate/accept?token=${token}`
  return NextResponse.json({ url, mode, expiresAt: expires.toISOString() })
}
