import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { encryptSecret, last4 } from "@/lib/crypto"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Note: the secret_cipher column is never selected — only identifying metadata.

export async function GET() {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const rows = await sql`
      SELECT id, provider, label, last4, scope, disabled, created_at, rotated_at
      FROM platform_api_keys ORDER BY provider, created_at DESC`
    return NextResponse.json({ keys: rows })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "load failed", keys: [] }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let provider = "", label: string | null = null, secret = "", scope = "platform"
  try {
    const body = await req.json()
    provider = String(body.provider || "").trim().toLowerCase()
    label = body.label ? String(body.label).trim() : null
    secret = String(body.secret || "").trim()
    if (body.scope) scope = String(body.scope).trim()
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }
  if (!provider || !secret) {
    return NextResponse.json({ error: "provider and secret are required" }, { status: 400 })
  }

  try {
    const cipher = encryptSecret(secret)
    const rows = await sql`
      INSERT INTO platform_api_keys (provider, label, secret_cipher, last4, scope, created_by)
      VALUES (${provider}, ${label}, ${cipher}, ${last4(secret)}, ${scope}, ${staff.id})
      RETURNING id, provider, label, last4, scope, disabled, created_at, rotated_at`
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'api_key.create', ${provider}, ${JSON.stringify({ scope })})`
    return NextResponse.json({ key: rows[0] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "create failed" }, { status: 500 })
  }
}
