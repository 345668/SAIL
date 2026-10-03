import { describe, it, expect, vi, beforeEach } from "vitest"
const rows = vi.hoisted(() => ({ queue: [] as any[][], fail: false }))
vi.mock("./db", () => ({ sql: async () => { if (rows.fail) throw new Error("db"); return rows.queue.shift() ?? [] } }))
import { isLockedOut, checkLock, MAX_FAILS_PER_EMAIL, MAX_FAILS_PER_IP, clientIp } from "./login-guard"

beforeEach(() => { rows.queue = []; rows.fail = false })

describe("isLockedOut", () => {
  it("locks at the per-account limit and at the per-address limit, not before", () => {
    expect(isLockedOut(MAX_FAILS_PER_EMAIL - 1, 0)).toBe(false)
    expect(isLockedOut(MAX_FAILS_PER_EMAIL, 0)).toBe(true)
    expect(isLockedOut(0, MAX_FAILS_PER_IP - 1)).toBe(false)
    expect(isLockedOut(0, MAX_FAILS_PER_IP)).toBe(true)
  })
})

describe("checkLock", () => {
  it("is open below the limit and closed at it", async () => {
    rows.queue = [[{ n: 4 }], [{ n: 0 }]]
    expect((await checkLock("A@Example.com", "1.1.1.1")).locked).toBe(false)
    rows.queue = [[{ n: 5 }], [{ n: 0 }]]
    expect(await checkLock("a@example.com", "1.1.1.1")).toEqual({ locked: true, retryAfterMin: 15 })
  })
  it("fails closed when the table cannot be read", async () => {
    rows.fail = true
    expect((await checkLock("a@example.com", "1.1.1.1")).locked).toBe(true)
  })
})

describe("clientIp", () => {
  it("takes the first forwarded address", () => {
    expect(clientIp(new Request("https://x.test", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } }))).toBe("9.9.9.9")
    expect(clientIp(new Request("https://x.test"))).toBe("unknown")
  })
})
