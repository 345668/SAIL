import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { EMPTY_AI_CONFIG, type AiRouterConfig } from "@/lib/ai-tasks"
import { encryptSecret, hasEncryptionKey, isEncrypted } from "@/lib/config-crypto"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const KEY = "ai_router_v1"

/**
 * Provider credentials held in this row.
 *
 * They are stored encrypted (enc:v1: under CONFIG_ENC_KEY — the scheme the
 * tenant app decrypts with, not this portal's platform-key cipher), they are
 * never returned to the browser, and they are never written to the audit log.
 * The page gets only whether each one is set and its last four characters.
 */
const SECRET_FIELDS = ["anthropicApiKey", "openaiApiKey", "geminiApiKey", "mistralApiKey", "qwenApiKey"] as const
type SecretField = (typeof SECRET_FIELDS)[number]

/** Plain settings the page may edit alongside the secrets. */
const PLAIN_FIELDS = ["qwenWorkspaceId", "qwenModel", "anthropicModel", "openaiModel", "geminiModel", "mistralModel"] as const

export interface KeyStatus { name: SecretField; set: boolean; last4: string | null; encrypted: boolean }

function keyStatuses(v: Record<string, unknown>): KeyStatus[] {
  return SECRET_FIELDS.map((name) => {
    const raw = typeof v[name] === "string" ? (v[name] as string) : ""
    if (!raw) return { name, set: false, last4: null, encrypted: false }
    // An encrypted value's tail is ciphertext, so there is no last4 to show
    // without decrypting — which this portal deliberately does not do.
    return { name, set: true, last4: isEncrypted(raw) ? null : raw.slice(-4), encrypted: isEncrypted(raw) }
  })
}

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
    const config = await read()
    const keys = keyStatuses(config as Record<string, unknown>)
    // Strip the secrets before this leaves the server. They were previously
    // sent to the browser in full.
    for (const name of SECRET_FIELDS) delete (config as Record<string, unknown>)[name]
    return NextResponse.json({ config, keys, canEncrypt: hasEncryptionKey() })
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

    for (const name of PLAIN_FIELDS) {
      if (body[name] === undefined) continue
      const value = String(body[name] ?? "").trim()
      if (value) next[name] = value
      else delete next[name]
    }

    const changedSecrets: string[] = []
    for (const name of SECRET_FIELDS) {
      if (body[name] === undefined) continue
      const value = String(body[name] ?? "").trim()
      if (!value) { delete next[name]; changedSecrets.push(`${name}:cleared`); continue }
      if (!hasEncryptionKey()) {
        return NextResponse.json({ error: "CONFIG_ENC_KEY is not set — refusing to store a provider key unencrypted." }, { status: 503 })
      }
      next[name] = encryptSecret(value)
      changedSecrets.push(name)
    }
    // Re-encrypt anything still held in plaintext, so any save also retires the
    // legacy values rather than writing them back in the clear.
    for (const name of SECRET_FIELDS) {
      const existing = next[name]
      if (typeof existing === "string" && existing && !isEncrypted(existing)) {
        if (!hasEncryptionKey()) {
          return NextResponse.json({ error: "CONFIG_ENC_KEY is not set — refusing to rewrite a provider key unencrypted." }, { status: 503 })
        }
        next[name] = encryptSecret(existing)
      }
    }

    await sql`
      INSERT INTO system_settings (key, value, updated_by, updated_at)
      VALUES (${KEY}, ${JSON.stringify(next)}::jsonb, NULL, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = NULL, updated_at = NOW()`

    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'ai_config.update', ${KEY}, ${JSON.stringify({
        ...Object.fromEntries(Object.entries(body).filter(([k]) => !(SECRET_FIELDS as readonly string[]).includes(k))),
        // Names only. The previous version logged the whole body, so saving a
        // key wrote that key into company_audit_log in plaintext.
        secretsChanged: changedSecrets,
      }).slice(0, 2000)}::jsonb)`

    const view = { ...next } as Record<string, unknown>
    const keys = keyStatuses(view)
    for (const name of SECRET_FIELDS) delete view[name]
    return NextResponse.json({ config: view, keys })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "save failed" }, { status: 500 })
  }
}
