import { describe, it, expect } from "vitest"
import { isProxyAllowed, PROXY_ALLOWLIST, ACT_AS_REQUIRED } from "./anker-proxy"

describe("the relay allowlist", () => {
  it("allows every listed path, exactly", () => {
    for (const p of PROXY_ALLOWLIST) expect(isProxyAllowed(p), p).toBe(true)
  })
  it("allows a campaign record and its deck by id, and nothing shaped differently", () => {
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e"
    expect(isProxyAllowed(`campaign/${id}`)).toBe(true)
    expect(isProxyAllowed(`campaign/${id}/deck`)).toBe(true)
    expect(isProxyAllowed(`campaign/${id}/anything`)).toBe(false)
    expect(isProxyAllowed(`campaign/${id}/deck/extra`)).toBe(false)
    expect(isProxyAllowed("campaign/short")).toBe(false)
  })
  it("refuses unlisted admin routes, traversal, prefixes and case tricks", () => {
    for (const p of ["admin/users", "admin", "admin/system/../users", "../admin/system", "/admin/system", "admin/system/", "ADMIN/SYSTEM", "admin/system?x=1", "admin/system#x", "admin%2Fusers", "", "campaign/../admin/users", "agents/run/../../admin/users"]) {
      expect(isProxyAllowed(p), p).toBe(false)
    }
  })
  it("every path that needs an acting user is itself on the allowlist", () => {
    for (const p of ACT_AS_REQUIRED) expect(isProxyAllowed(p), p).toBe(true)
  })
  it("has no wildcard entries", () => {
    for (const p of PROXY_ALLOWLIST) expect(p).not.toMatch(/[*?[\]]/)
  })
})
