/**
 * DB-editable integration keys — ported from Anker's lib/config/integration-keys.ts.
 *
 * Same storage contract as the tenant app: one `system_settings` row keyed
 * 'integration_keys_v1' holding a JSON object of NAME -> encrypted value, with
 * process.env[NAME] as the deployment-time fallback. The tenant app resolves
 * these at runtime, so the row shape, the key name allowlist and the encryption
 * must all match exactly.
 *
 * The allowlist is a hard guard: core secrets (SUPABASE_SERVICE_ROLE_KEY,
 * CRON_SECRET, BLOB_READ_WRITE_TOKEN, DATABASE_URL) are intentionally absent and
 * stay env-only — they can never be written through this surface.
 *
 * Read-side caching from Anker is dropped: this portal only edits keys and shows
 * their status, it never consumes them on a hot path.
 */
import { sql } from "@/lib/db"
import { encryptSecret, decryptSecret, hasEncryptionKey } from "./config-crypto"

export const INTEGRATION_KEY_NAMES = [
  "RESEND_API_KEY",
  "OPENSANCTIONS_API_KEY",
  "COMPANIES_HOUSE_API_KEY",
  "COMP_BENCHMARK_API_URL",
  "COMP_BENCHMARK_API_KEY",
  "DOCUSIGN_BASE_URI",
  "DOCUSIGN_ACCOUNT_ID",
  "DOCUSIGN_ACCESS_TOKEN",
  "DOC_WORKER_URL",
  "DOC_WORKER_TOKEN",
] as const
export type IntegrationKeyName = (typeof INTEGRATION_KEY_NAMES)[number]
const NAME_SET = new Set<string>(INTEGRATION_KEY_NAMES)
export const isIntegrationKeyName = (n: string): n is IntegrationKeyName => NAME_SET.has(n)

const SETTINGS_KEY = "integration_keys_v1"
type KeyMap = Partial<Record<IntegrationKeyName, string>>

async function ensureSystemSettingsTable(): Promise<void> {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY, value JSONB NOT NULL, description TEXT,
        updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
  } catch (e: any) {
    console.warn("[integration-keys] ensure system_settings:", e?.message)
  }
}

function parseRow(raw: unknown): Record<string, any> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, any>
  if (typeof raw === "string") { try { return JSON.parse(raw) ?? {} } catch { return {} } }
  return {}
}

/** Read the DB-stored keys (decrypted). On any error returns {} so env still wins. */
export async function readIntegrationKeys(): Promise<KeyMap> {
  const map: KeyMap = {}
  try {
    const rows = await sql`SELECT value FROM system_settings WHERE key = ${SETTINGS_KEY} LIMIT 1`
    const obj = parseRow((rows as any[])[0]?.value)
    for (const k of INTEGRATION_KEY_NAMES) {
      const stored = obj[k]
      if (typeof stored !== "string" || !stored) continue
      const plain = decryptSecret(stored) // null if encrypted-but-undecryptable
      if (plain && plain.trim()) map[k] = plain.trim()
    }
  } catch (e: any) {
    console.warn("[integration-keys] read failed (env-only fallback):", e?.message)
  }
  return map
}

/** Where a key's active value comes from — DB wins over env. */
export type KeySource = "db" | "env" | null

export interface KeyStatus { set: boolean; source: KeySource; hint: string | null }

const mask = (v?: string | null) => (v && v.length > 4 ? `…${v.slice(-4)}` : v ? "••••" : null)

/**
 * Masked status for every allowlisted name. Never returns a full value — only
 * whether it is set, where it resolves from, and a last-4 hint.
 */
export async function statusPayload(): Promise<{ encryptionConfigured: boolean; keys: Record<string, KeyStatus> }> {
  const db = await readIntegrationKeys()
  const keys: Record<string, KeyStatus> = {}
  for (const name of INTEGRATION_KEY_NAMES) {
    const fromDb = db[name]
    const fromEnv = process.env[name]?.trim()
    const val = fromDb || fromEnv || undefined
    keys[name] = {
      set: !!val,
      source: fromDb ? "db" : fromEnv ? "env" : null,
      hint: mask(val),
    }
  }
  return { encryptionConfigured: hasEncryptionKey(), keys }
}

/** system_settings.updated_by carries a users.id FK in the tenant schema. */
async function resolveUpdatedBy(updatedBy?: string | null): Promise<string | null> {
  if (!updatedBy) return null
  try {
    const rows = (await sql`
      SELECT id FROM users WHERE id::text = ${updatedBy} OR email = ${updatedBy} LIMIT 1
    `) as { id: string }[]
    return rows[0]?.id ?? null
  } catch { return null }
}

/**
 * Upsert integration keys (encrypted). Only writes names actually included; an
 * explicit "" deletes a key so the env fallback resumes. Requires
 * CONFIG_ENC_KEY — refuses to store plaintext secrets. Names outside the
 * allowlist are ignored.
 */
export async function saveIntegrationKeys(
  updates: Record<string, string>,
  updatedBy?: string | null,
): Promise<KeyMap> {
  if (!hasEncryptionKey()) {
    throw new Error("CONFIG_ENC_KEY is not set — cannot store integration keys encrypted at rest.")
  }
  await ensureSystemSettingsTable()

  let current: Record<string, any> = {}
  try {
    const rows = await sql`SELECT value FROM system_settings WHERE key = ${SETTINGS_KEY} LIMIT 1`
    current = parseRow((rows as any[])[0]?.value)
  } catch { current = {} }

  const merged: Record<string, string> = { ...current }
  for (const [k, v] of Object.entries(updates)) {
    if (!isIntegrationKeyName(k)) continue // hard guard against core secrets
    if (typeof v === "string" && v.trim()) merged[k] = encryptSecret(v.trim())
    else delete merged[k]
  }

  const safeUpdatedBy = await resolveUpdatedBy(updatedBy)
  await sql`
    INSERT INTO system_settings (key, value, description, updated_by, updated_at)
    VALUES (${SETTINGS_KEY}, ${JSON.stringify(merged)}::jsonb, 'DB-editable integration keys (encrypted)', ${safeUpdatedBy}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`

  return readIntegrationKeys()
}
