import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto"

/**
 * AES-256-GCM for platform API-key secrets at rest. The key is derived from
 * SECRET_KEY (same env the tenant app already sets). Ciphertext format:
 *   gcm$<ivB64>$<tagB64>$<dataB64>
 * Secrets are only ever decrypted server-side to actually use a key; the UI
 * only sees `last4`.
 */
function keyBytes(): Buffer {
  const secret = process.env.SECRET_KEY || ""
  if (!secret) throw new Error("SECRET_KEY is required to encrypt platform keys")
  // Derive a stable 32-byte key. Static salt is fine: SECRET_KEY is the secret.
  return scryptSync(secret, "anker-company-portal", 32)
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv)
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `gcm$${iv.toString("base64")}$${tag.toString("base64")}$${enc.toString("base64")}`
}

export function decryptSecret(blob: string): string {
  const [scheme, ivB64, tagB64, dataB64] = blob.split("$")
  if (scheme !== "gcm") throw new Error("unrecognized cipher blob")
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8")
}

export function last4(s: string): string {
  return s.length <= 4 ? s : s.slice(-4)
}
