/**
 * GET   /api/integration-keys — masked status of the DB-editable integration keys.
 * PATCH /api/integration-keys — save/clear keys. Body: { NAME: "value", ... } ("" clears).
 *
 * Ported from Anker's app/api/admin/integration-keys/route.ts. The gate becomes
 * this portal's staff session; audit writes go to company_audit_log (the portal's
 * own log) rather than Anker's audit_events, since this portal has no logAudit.
 *
 * GET never returns a full value — only set / source / last-4 hint. Only
 * allowlisted names are accepted, so core secrets can never be written here.
 */
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { hasEncryptionKey } from "@/lib/config-crypto"
import { isIntegrationKeyName, saveIntegrationKeys, statusPayload } from "@/lib/integration-keys"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await statusPayload())
}

export async function PATCH(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!hasEncryptionKey()) {
    return NextResponse.json(
      { error: "CONFIG_ENC_KEY is not set — integration keys can't be stored encrypted. Set it before editing keys here." },
      { status: 400 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  // Keep only allowlisted names; coerce to string. Anything else is dropped.
  const updates: Record<string, string> = {}
  const changed: string[] = []
  for (const [k, v] of Object.entries(body)) {
    if (!isIntegrationKeyName(k)) continue
    updates[k] = typeof v === "string" ? v : ""
    changed.push(k)
  }
  if (!changed.length) {
    return NextResponse.json({ error: "No editable integration keys in the request." }, { status: 400 })
  }

  try {
    await saveIntegrationKeys(updates, staff.email)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Save failed." }, { status: 500 })
  }

  // Audit names + set/clear only — never the values.
  try {
    await sql`
      INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (
        ${staff.id}, ${staff.email}, 'integration_keys.update', 'integration_keys_v1',
        ${JSON.stringify({ changed: changed.map((k) => ({ key: k, action: updates[k] ? "set" : "clear" })) })}::jsonb
      )`
  } catch (e: any) {
    // Never fail a successful save because the audit write failed.
    console.error("[integration-keys] audit write failed:", e?.message)
  }

  return NextResponse.json({ ok: true, ...(await statusPayload()) })
}
