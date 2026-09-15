/**
 * Secret encryption at rest for DB-editable integration keys.
 *
 * PORTED VERBATIM from Anker's lib/config/crypto.ts and MUST stay that way.
 *
 * This is deliberately NOT lib/crypto.ts. That module encrypts platform_api_keys
 * for this portal alone and is incompatible in every dimension:
 *
 *              this module (Anker)        lib/crypto.ts (portal)
 *   key env    CONFIG_ENC_KEY             SECRET_KEY
 *   KDF        sha256(secret)             scrypt(secret, "anker-company-portal")
 *   format     enc:v1:<iv>:<tag>:<ct>     gcm$<iv>$<tag>$<data>
 *   on failure returns null               throws
 *
 * Integration keys are written here and read by the TENANT app at runtime
 * (lib/compliance/companies-house.ts, lib/modules/opensanctions.ts, Resend,
 * DocuSign…). Anker's decryptSecret treats anything not starting with `enc:v1:`
 * as legacy plaintext and returns it unchanged — so encrypting with the wrong
 * helper would hand integrations a literal "gcm$…" string as their API key and
 * fail silently. Hence the duplication.
 *
 * Payload format: enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 */
import crypto from "node:crypto"

const PREFIX = "enc:v1:"

export function hasEncryptionKey(): boolean {
  return !!process.env.CONFIG_ENC_KEY
}

/** Derive a stable 32-byte key from CONFIG_ENC_KEY. */
function keyBytes(): Buffer {
  const secret = process.env.CONFIG_ENC_KEY
  if (!secret) throw new Error("CONFIG_ENC_KEY is not set — cannot encrypt/decrypt secrets.")
  return crypto.createHash("sha256").update(secret, "utf8").digest()
}

export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith(PREFIX)
}

/** Encrypt a plaintext secret. Requires CONFIG_ENC_KEY. */
export function encryptSecret(plain: string): string {
  const key = keyBytes()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`
}

/**
 * Decrypt a stored secret. Returns:
 *   - the plaintext for a valid `enc:v1:` payload,
 *   - the value unchanged if it isn't an `enc:v1:` payload (legacy plaintext),
 *   - null if it's encrypted but can't be decrypted (missing/wrong key, tampered).
 */
export function decryptSecret(value: string): string | null {
  if (!isEncrypted(value)) return value
  if (!hasEncryptionKey()) return null
  const parts = value.slice(PREFIX.length).split(":")
  if (parts.length !== 3) return null
  try {
    const [ivB64, tagB64, ctB64] = parts
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivB64, "base64"))
    decipher.setAuthTag(Buffer.from(tagB64, "base64"))
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()])
    return pt.toString("utf8")
  } catch {
    return null
  }
}
