import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { EMPTY_AI_CONFIG, type AiRouterConfig } from "@/lib/ai-tasks"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const KEY = "ai_router_v1"

async function read(): Promise<AiRouterConfig> {
  const rows = await sql`SELECT value FROM system_settings WHERE key = ${KEY} LIMIT 1`
  const v = (rows[0] as any)?.value
  if (!v || typeof v !== "object") return { ...EMPTY_AI_CONFIG }
  return {
    ...EMPTY_AI_CONFIG,
    ...v,
    enabled: { ...(v.enabled ?? {}) },
    modelOverride: { ...(v.modelOverride ?? {}) },
  }
}

export async function GET() {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    return NextResponse.json({ config: await read() })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "load failed" }, { status: 500 })
  }
}

/**
 * Partial update of the shared AI-router knob. The portal writes updated_by as
 * NULL on purpose — the tenant column FKs to tenant users, and portal staff are
 * a different identity realm. Unknown keys in the stored blob are preserved.
 */
export async function PATCH(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }

  try {
    const current = await read()
    const next: AiRouterConfig = {
      ...current,
      enabled: { ...current.enabled },
      modelOverride: { ...current.modelOverride },
    }

    if (body.enabled && typeof body.enabled === "object") {
      for (const [k, val] of Object.entries(body.enabled)) {
        if (val === true) delete next.enabled[k] // default is enabled → drop the key
        else next.enabled[k] = false
      }
    }
    if (body.modelOverride && typeof body.modelOverride === "object") {
      for (const [k, val] of Object.entries(body.modelOverride)) {
        const s = String(val ?? "").trim()
        if (s) next.modelOverride[k] = s
        else delete next.modelOverride[k]
      }
    }
    if (body.providerOverride !== undefined) {
      const p = body.providerOverride
      next.providerOverride = p === null || p === "" ? null : String(p)
    }
    if (body.providerStrict !== undefined) next.providerStrict = !!body.providerStrict

    await sql`
      INSERT INTO system_settings (key, value, updated_by, updated_at)
      VALUES (${KEY}, ${JSON.stringify(next)}::jsonb, NULL, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = NULL, updated_at = NOW()`

    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'ai_config.update', ${KEY}, ${JSON.stringify(body).slice(0, 2000)}::jsonb)`

    return NextResponse.json({ config: next })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "save failed" }, { status: 500 })
  }
}
