import { describe, it, expect } from "vitest"
import { base32Encode, base32Decode, generateSecret, hotp, totpAt, verifyTotp, otpauthUri, stepOf } from "./totp"

// RFC 6238 appendix B: the shared secret is the ASCII string "12345678901234567890"; these are the 6-digit tails of the
// published 8-digit SHA-1 values.
const SECRET = base32Encode(Buffer.from("12345678901234567890"))
describe("totp, against the RFC 6238 vectors", () => {
  it.each([[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]])(
    "at %i seconds the code is %s", (t, code) => expect(totpAt(SECRET, t * 1000)).toBe(code))
  it("hotp matches the RFC 4226 vectors", () => {
    const k = Buffer.from("12345678901234567890")
    expect([0, 1, 2, 3].map((c) => hotp(k, c))).toEqual(["755224", "287082", "359152", "969429"])
  })
})

describe("base32", () => {
  it("round-trips", () => {
    for (const n of [1, 5, 20, 33]) { const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256)); expect(base32Decode(base32Encode(b))).toEqual(b) }
  })
  it("rejects characters outside the alphabet", () => expect(() => base32Decode("AB1!")).toThrow())
  it("generates 160-bit secrets that differ", () => {
    const a = generateSecret(), b = generateSecret()
    expect(a).toHaveLength(32); expect(a).not.toBe(b)
  })
})

describe("verifyTotp", () => {
  const now = 1_700_000_000_000
  const code = (offsetSteps: number) => totpAt(SECRET, now + offsetSteps * 30_000)
  it("accepts the current code and one step either side, nothing further", () => {
    expect(verifyTotp(SECRET, code(0), { now })).toBe(stepOf(now))
    expect(verifyTotp(SECRET, code(-1), { now })).toBe(stepOf(now) - 1)
    expect(verifyTotp(SECRET, code(1), { now })).toBe(stepOf(now) + 1)
    expect(verifyTotp(SECRET, code(3), { now })).toBeNull()
    expect(verifyTotp(SECRET, code(-3), { now })).toBeNull()
  })
  it("refuses a replay of a step already used", () => {
    const step = verifyTotp(SECRET, code(0), { now })!
    expect(verifyTotp(SECRET, code(0), { now, lastUsedStep: step })).toBeNull()
    expect(verifyTotp(SECRET, code(1), { now, lastUsedStep: step })).toBe(step + 1)
  })
  it("refuses anything that is not six digits", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5", null as any]) expect(verifyTotp(SECRET, bad, { now })).toBeNull()
  })
  it("ignores spaces in a code typed as '123 456'", () => {
    const c = code(0); expect(verifyTotp(SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, { now })).not.toBeNull()
  })
})

describe("otpauthUri", () => {
  it("names the issuer and account and carries the secret", () => {
    const u = otpauthUri({ email: "a@b.de", secret: "ABCDEFGH" })
    expect(u).toContain("otpauth://totp/Anker%20SAIL:a%40b.de")
    expect(u).toContain("secret=ABCDEFGH")
    expect(u).toContain("digits=6")
  })
})
