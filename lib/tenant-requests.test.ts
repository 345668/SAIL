import { describe, it, expect, vi, beforeEach } from "vitest"
const h = vi.hoisted(() => ({ forward: vi.fn(), audit: vi.fn() }))
vi.mock("./anker-proxy", async (orig) => ({ ...(await orig<any>()), forwardToAnker: h.forward }))
vi.mock("./audit", () => ({ audit: h.audit }))
vi.mock("./db", () => ({ sql: vi.fn() }))
import { requestExport, requestDryRun, scheduleErasure, cancelTenantRequest, listTenantRequests } from "./tenant-requests"
import { isProxyAllowed } from "./anker-proxy"

const staff = { id: "s", email: "staff@sail.test", role: "staff" as const }, admin = { id: "a", email: "admin@sail.test", role: "admin" as const }, root = { id: "r", email: "root@sail.test", role: "superadmin" as const }
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
beforeEach(() => { h.forward.mockReset(); h.audit.mockReset() })

describe("who may do what", () => {
  it("staff can only read; admins export and cancel; only a superadmin starts or schedules an erasure", async () => {
    h.forward.mockResolvedValue(ok({ id: "r1", tables: 3, bytes: 10, requests: [] }))
    await expect(requestExport(staff, "o1")).rejects.toMatchObject({ status: 403 }); await expect(requestExport(admin, "o1")).resolves.toMatchObject({ id: "r1" })
    await expect(requestDryRun(admin, "o1")).rejects.toMatchObject({ status: 403 }); await expect(requestDryRun(root, "o1")).resolves.toBeDefined()
    await expect(scheduleErasure(admin, "o1", "r1", "Acme")).rejects.toMatchObject({ status: 403 }); await expect(scheduleErasure(root, "o1", "r1", "Acme")).resolves.toBeDefined()
    await expect(cancelTenantRequest(staff, "o1", "r1")).rejects.toMatchObject({ status: 403 }); await expect(cancelTenantRequest(admin, "o1", "r1")).resolves.toBeUndefined()
    await expect(listTenantRequests(staff, "o1")).resolves.toEqual([])
  })
  it("calls the tenant app with the operator named, and audits each action with no content", async () => {
    h.forward.mockResolvedValue(ok({ id: "r1", tables: 3, bytes: 10, dryRun: { toDelete: 5 }, blockers: [{ code: "not_offboarding" }], executeAfter: "2026-10-12" }))
    await requestDryRun(root, "onboarding:vc:abc"); await scheduleErasure(root, "o1", "r1", "Acme")
    expect(h.forward.mock.calls[0][0]).toMatchObject({ path: "admin/tenants/onboarding:vc:abc/requests", method: "POST", staffEmail: "root@sail.test" })
    expect(JSON.parse(h.forward.mock.calls[1][0].body)).toEqual({ action: "schedule", requestId: "r1", confirmName: "Acme" })
    expect(h.audit.mock.calls.map((c) => c[0])).toEqual(["tenant.erasure.dry_run", "tenant.erasure.schedule"]); expect(JSON.stringify(h.audit.mock.calls)).not.toContain("Acme")
  })
  it("a workspace id with anything else in it never reaches a URL", async () => {
    for (const bad of ["a/b", "../x", "a b", "a%2Fb", ""]) await expect(listTenantRequests(root, bad)).rejects.toMatchObject({ status: 400 })
    expect(h.forward).not.toHaveBeenCalled()
  })
  it("the tenant app's refusal reaches the operator as a plain message", async () => {
    h.forward.mockResolvedValue(new Response(JSON.stringify({ error: "The workspace must be in the offboarding state first." }), { status: 409 }))
    await expect(scheduleErasure(root, "o1", "r1", "Acme")).rejects.toMatchObject({ message: expect.stringMatching(/offboarding/) })
  })
})

describe("the relay allowlist", () => {
  it("allows only the requests path for a workspace id, nothing wider", () => {
    expect(isProxyAllowed("admin/tenants/onboarding:vc:abc/requests")).toBe(true); expect(isProxyAllowed("admin/tenants/a_b-c/requests")).toBe(true)
    for (const bad of ["admin/tenants/x/requests/extra", "admin/tenants//requests", "admin/tenants/../requests", "admin/tenants/x/export", "admin/tenants/x y/requests"]) expect(isProxyAllowed(bad), bad).toBe(false)
  })
})
