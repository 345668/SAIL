/**
 * News-provider runtime keys.
 *
 * Resolves a provider API key from (in order):
 *   1. The system_settings row keyed 'news_providers_v1' (admin-managed via
 *      /dashboard/admin/newsroom/api-keys)
 *   2. process.env[KEY] (deployment-time fallback)
 *
 * Cached in-process for 5 s — same TTL the AI router uses. Admins hit
 * invalidate() after a save to force re-read.
 *
 * The shape lives in system_settings as a JSONB object, e.g.
 *   {
 *     "ALPHA_VANTAGE_API_KEY": "K-abc…",
 *     "FINNHUB_API_KEY":       "fh-…",
 *     ...,
 *     "MASSIVE_API_URL":       "https://…"
 *   }
 * Keys are matched verbatim so the env-var names and the DB names are
 * always the same — easier to grep and audit.
 *
 * At rest the DB values are ENCRYPTED, the same as platform_api_keys: each one
 * is an enc:v1: payload under CONFIG_ENC_KEY. That scheme specifically, and not
 * the portal's own lib/crypto.ts, because this row is read by BOTH apps — the
 * portal writes it and the tenant app reads it at fetch time, so anything the
 * tenant cannot decrypt would reach a provider as a literal "gcm$…" string and
 * fail as an invalid key. Reads still accept plaintext, so values written
 * before this stay working until they are re-saved.
 */

import { sql } from "@/lib/db"
import { decryptSecret, encryptSecret, hasEncryptionKey, isEncrypted } from "@/lib/config-crypto"

export const NEWS_KEY_NAMES = [
  "ALPHA_VANTAGE_API_KEY",
  "FINNHUB_API_KEY",
  "MARKETAUX_API_KEY",
  "NEWSAPI_KEY",
  "FRED_API_KEY",
  "MASSIVE_API_KEY",
  "MASSIVE_API_URL",
] as const
export type NewsKeyName = (typeof NEWS_KEY_NAMES)[number]

type KeyMap = Partial<Record<NewsKeyName, string>>

/**
 * Coerce a system_settings.value into a plain object.
 *
 * jsonb comes back parsed from some drivers and as a string from others, and
 * the string form can itself be a JSON-encoded string, so one parse can yield
 * another string rather than an object. The previous version accepted that
 * result as the settings object, and the save path then spread it — spreading
 * a string produces one numeric key per character. The live row had grown to
 * 6,771 char-indexed entries and 27 KB around six real keys, doubling with
 * every save. Unwrap until it is an object, and refuse anything else.
 */
function normalizeSettings(raw: unknown): Record<string, any> | null {
  let value: unknown = raw
  for (let i = 0; i < 3 && typeof value === "string"; i++) {
    try { value = JSON.parse(value) } catch { return null }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, any>
}

let _cache: { at: number; map: KeyMap } | null = null
const TTL_MS = 5_000

export async function readNewsKeys(): Promise<KeyMap> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.map
  try {
    const rows = await sql`SELECT value FROM system_settings WHERE key = 'news_providers_v1' LIMIT 1`
    const obj = normalizeSettings(rows[0]?.value)
    const map: KeyMap = {}
    if (obj) {
      for (const k of NEWS_KEY_NAMES) {
        const val = obj[k]
        if (typeof val !== "string" || !val.trim()) continue
        // Values written before encryption are plaintext and stay readable,
        // so a deploy does not knock the providers offline before the backfill
        // runs. decryptSecret returns null on a bad key or tampered payload.
        const plain = isEncrypted(val) ? decryptSecret(val) : val
        if (typeof plain === "string" && plain.trim()) map[k] = plain.trim()
        else console.warn(`[news/runtime-keys] ${k} could not be decrypted — is CONFIG_ENC_KEY the one it was written with?`)
      }
    }
    _cache = { at: Date.now(), map }
    return map
  } catch (e: any) {
    // system_settings might not exist yet — fall back to env-only.
    console.warn("[news/runtime-keys] read failed (falling back to env):", e?.message)
    const map: KeyMap = {}
    _cache = { at: Date.now(), map }
    return map
  }
}

/**
 * Which stored keys are already encrypted at rest.
 *
 * readNewsKeys decrypts, so callers cannot tell from its result whether a value
 * is protected. The keys admin needs to show that, and to know whether the
 * one-off backfill still has work to do.
 */
export async function readNewsKeyEncryptionState(): Promise<Partial<Record<NewsKeyName, boolean>>> {
  try {
    const rows = await sql`SELECT value FROM system_settings WHERE key = 'news_providers_v1' LIMIT 1`
    const obj = normalizeSettings(rows[0]?.value)
    const out: Partial<Record<NewsKeyName, boolean>> = {}
    if (obj) {
      for (const k of NEWS_KEY_NAMES) {
        const v = obj[k]
        if (typeof v === "string" && v.trim()) out[k] = isEncrypted(v)
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Resolve a single key, env-fallback. Sync wrapper around the cached read. */
export function getNewsKeySync(name: NewsKeyName): string | undefined {
  const fromCache = _cache?.map[name]
  if (fromCache) return fromCache
  const fromEnv = process.env[name]
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : undefined
}

/** Async-safe variant — primes the cache when stale. */
export async function getNewsKey(name: NewsKeyName): Promise<string | undefined> {
  await readNewsKeys()
  return getNewsKeySync(name)
}

export function invalidateNewsKeyCache(): void {
  _cache = null
}

/**
 * Upsert the news_providers_v1 settings row. Only writes the keys the
 * caller actually included; other keys are left intact.
 *
 * Pass an explicit "" (empty string) to delete a key — useful for
 * rotating a key out of DB so the env-var fallback kicks back in.
 *
 * Implementation mirrors lib/ai/runtime-config.ts patchRouterConfig:
 *   - Uses (key, value, updated_by, updated_at) shape — matches the
 *     pattern that's proven to work in production
 *   - safeUpdatedBy guards against FK violations (system_settings.updated_by
 *     references users.id in production)
 *   - Auto-bootstraps the system_settings table if it doesn't exist
 *     (production DBs that skipped the 2026-05-08 migration would
 *     otherwise silently 500 here)
 *   - Returns the freshly-read map (not the merged one) so the caller
 *     sees authoritative DB state, not optimistic in-memory
 */
export async function saveNewsKeys(
  updates: Partial<Record<NewsKeyName, string>>,
  updatedBy?: string | null,
): Promise<KeyMap> {
  await ensureSystemSettingsTable()

  // Read current value. Be tolerant of jsonb returning as object OR string
  // depending on driver version.
  // These are third-party credentials, so they are stored encrypted, the same
  // as platform_api_keys. Refuse rather than fall back to plaintext: a silent
  // downgrade would leave keys in the clear exactly when someone believed they
  // were protected.
  if (!hasEncryptionKey()) {
    throw new Error("CONFIG_ENC_KEY is not set — refusing to store provider keys unencrypted.")
  }

  let stored: unknown = null
  try {
    const rows = await sql`SELECT value FROM system_settings WHERE key = 'news_providers_v1' LIMIT 1`
    stored = rows[0]?.value
  } catch (e: any) {
    console.warn("[news/runtime-keys] read current failed (continuing with empty):", e?.message)
  }
  const current: Record<string, any> = normalizeSettings(stored) ?? {}

  // Carry forward only the keys this module owns. Anything else in the row is
  // not ours to preserve, and it is how the char-indexed junk accumulated.
  const merged: Record<string, string> = {}
  for (const k of NEWS_KEY_NAMES) {
    const existing = current[k]
    if (typeof existing === "string" && existing.trim()) merged[k] = existing.trim()
  }
  for (const k of NEWS_KEY_NAMES) {
    if (!(k in updates)) continue
    const v = updates[k]
    if (typeof v === "string" && v.trim()) {
      merged[k] = encryptSecret(v.trim())
    } else {
      delete merged[k]
    }
  }
  // Re-encrypt anything still sitting in the row as plaintext, so the first
  // save after this ships also retires the legacy values.
  for (const k of Object.keys(merged) as NewsKeyName[]) {
    if (!isEncrypted(merged[k])) merged[k] = encryptSecret(merged[k])
  }

  // Same FK-safety dance as patchRouterConfig.
  const safeUpdatedBy = await resolveUpdatedBy(updatedBy)

  // Mirror the proven AI router shape: (key, value, updated_by, updated_at)
  // — no description column needed, ON CONFLICT updates the three columns
  // that can change.
  try {
    await sql`
      INSERT INTO system_settings (key, value, updated_by, updated_at)
      VALUES (
        'news_providers_v1',
        ${JSON.stringify(merged)}::jsonb,
        ${safeUpdatedBy},
        NOW()
      )
      ON CONFLICT (key) DO UPDATE SET
        value      = EXCLUDED.value,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
    `
    console.log(`[news/runtime-keys] saved ${Object.keys(merged).length} keys`)
  } catch (e: any) {
    console.error("[news/runtime-keys] UPSERT failed:", e?.message, e?.code)
    throw new Error(`Failed to persist news keys: ${e?.message ?? "unknown error"}`)
  }

  invalidateNewsKeyCache()
  return readNewsKeys()
}

/**
 * Create system_settings if missing. Production DBs that didn't get the
 * 2026-05-08-system-settings migration would otherwise 500 on the first
 * write here with 'relation "system_settings" does not exist'.
 *
 * Safe to call every save — CREATE TABLE IF NOT EXISTS is a no-op when
 * the table already exists.
 */
async function ensureSystemSettingsTable(): Promise<void> {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        key         TEXT PRIMARY KEY,
        value       JSONB NOT NULL,
        description TEXT,
        updated_by  TEXT,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  } catch (e: any) {
    console.warn("[news/runtime-keys] ensure system_settings:", e?.message)
  }
}

/**
 * The company portal's system_settings.updated_by has no FK to the tenant
 * users table (portal staff are a separate identity realm), so we always
 * write NULL rather than resolving a tenant user id.
 */
async function resolveUpdatedBy(_input?: string | null): Promise<string | null> {
  return null
}
