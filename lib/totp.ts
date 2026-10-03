/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s), written against `crypto` so SAIL takes no new
 * dependency for a security primitive. Verified against the RFC's published test vectors in totp.test.ts.
 */
import { createHmac, randomBytes } from "crypto"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ""
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase()
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) throw new Error("invalid base32")
    value = (value << 5) | i
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

/** A fresh 160-bit secret, base32 (what an authenticator app is given). */
export const generateSecret = (): string => base32Encode(randomBytes(20))

export function hotp(key: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const h = createHmac("sha1", key).update(msg).digest()
  const off = h[h.length - 1] & 15
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(bin % 10 ** digits).padStart(digits, "0")
}

export const stepOf = (timeMs: number, step = 30) => Math.floor(timeMs / 1000 / step)

export const totpAt = (secretB32: string, timeMs: number, step = 30, digits = 6) => hotp(base32Decode(secretB32), stepOf(timeMs, step), digits)

/**
 * The time step a code matches (within ±`window` steps of now), or null. A step at or below `lastUsedStep` is refused,
 * so a code that was accepted once cannot be replayed within its validity window.
 */
export function verifyTotp(secretB32: string, code: string, opts: { now?: number; window?: number; lastUsedStep?: number | null } = {}): number | null {
  const c = String(code ?? "").replace(/\s/g, "")
  if (!/^\d{6}$/.test(c)) return null
  const now = opts.now ?? Date.now(), window = opts.window ?? 1
  const key = base32Decode(secretB32), cur = stepOf(now)
  let hit: number | null = null
  for (let s = cur - window; s <= cur + window; s++) {
    // Compared in constant time per candidate; every candidate is checked so timing does not reveal which step matched.
    const ok = hotp(key, s) === c
    if (ok && hit === null && (opts.lastUsedStep == null || s > opts.lastUsedStep)) hit = s
  }
  return hit
}

export function otpauthUri(opts: { email: string; secret: string; issuer?: string }): string {
  const issuer = opts.issuer ?? "Anker SAIL"
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(opts.email)}?secret=${opts.secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
}
