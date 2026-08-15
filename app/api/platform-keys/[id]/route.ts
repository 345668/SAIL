import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Toggle disabled state.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  let disabled = true
  try {
    const body = await req.json()
    disabled = Boolean(body.disabled)
  } catch { /* default */ }
  try {
    const rows = await sql`
      UPDATE platform_api_keys SET disabled = ${disabled} WHERE id = ${id}
      RETURNING id, provider, label, last4, scope, disabled, created_at, rotated_at`
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 })
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target)
      VALUES (${staff.id}, ${staff.email}, ${disabled ? "api_key.disable" : "api_key.enable"}, ${id})`
    return NextResponse.json({ key: rows[0] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "update failed" }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  try {
    await sql`DELETE FROM platform_api_keys WHERE id = ${id}`
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target)
      VALUES (${staff.id}, ${staff.email}, 'api_key.delete', ${id})`
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "delete failed" }, { status: 500 })
  }
}
