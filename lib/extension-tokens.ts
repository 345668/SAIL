import { createHash, randomBytes } from "node:crypto"

/**
 * Anker LinkedIn extension bearer tokens.
 *
 * MUST stay byte-identical to Anker's lib/extension/auth.ts. The tenant app
 * authenticates every /api/extension/* call by hashing the presented bearer
 * and matching extension_tokens.token_hash — any drift in the prefix, the
 * random length, the base64url alphabet or the digest silently invalidates
 * every token minted from this portal.
 */
export const TOKEN_PREFIX = "ank_"

export function mintToken(): { plaintext: string; hash: string; prefix: string } {
  // ank_ + 32 random bytes -> base64url -> 43 chars
  const raw = randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const plaintext = TOKEN_PREFIX + raw
  const hash = createHash("sha256").update(plaintext).digest("hex")
  return { plaintext, hash, prefix: plaintext.slice(0, 12) }
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex")
}

/** extension_tokens.user_id is uuid — reject anything that would error at insert. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim())
}
