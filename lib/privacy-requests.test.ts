import { describe, it, expect, vi, beforeEach } from "vitest"
const state = vi.hoisted(() => ({ calls: [] as any[], status: 200, body: {} as any, audits: [] as any[] }))
vi.mock("./anker-proxy", () => ({ forwardToAnker: async (i: any) => { state.calls.push(i); return new Response(JSON.stringify(state.body), { status: state.status }) } }))
vi.mock("./audit", () => ({ audit: async (...a: any[]) => { state.audits.push(a) } }))
import { actOnPrivacyRequest, getPrivacyRequest, listPrivacyRequests } from "./privacy-requests"

const id = "0f8fad5b-d9cb-469f-a165-70867728950e"
const admin = { id: "a", email: "admin@sail.test", role: "admin" as const }, staff = { id: "s", email: "staff@sail.test", role: "staff" as const }, root = { id: "r", email: "root@sail.test", role: "superadmin" as const }
beforeEach(() => { state.calls.length = 0; state.audits.length = 0; state.status = 200; state.body = { rows: 1 } })

describe("privacy requests in the portal", () => {
  it("lets staff read, but only admins act; erase needs a superadmin; refuse and extend need a reason", async () => {
    state.body = { requests: [] }; expect(await listPrivacyRequests(staff)).toEqual([])
    await expect(actOnPrivacyRequest(staff, id, { action: "access" })).rejects.toMatchObject({ status: 403 })
    await expect(actOnPrivacyRequest(admin, id, { action: "erase" })).rejects.toMatchObject({ status: 403 })
    await expect(actOnPrivacyRequest(admin, id, { action: "refuse", reason: "no" })).rejects.toThrow(/10 characters/)
    await expect(actOnPrivacyRequest(admin, id, { action: "extend", reason: "short", days: 5 })).rejects.toThrow(/10 characters/)
    expect(state.calls.filter((c) => c.method === "POST")).toHaveLength(0)
  })
  it("sends the action to the app with the operator named, and audits without any personal data", async () => {
    await actOnPrivacyRequest(admin, id, { action: "rectify", ids: ["x"], changes: { first_name: "Anne", email: "anne@secret.com" } })
    expect(state.calls[0]).toMatchObject({ path: `admin/privacy-requests/${id}`, method: "POST", staffEmail: "admin@sail.test" })
    expect(state.audits[0][0]).toBe("platform.privacy_request.rectify")
    expect(JSON.stringify(state.audits)).not.toMatch(/Anne|secret/)
    expect(state.audits[0][3]).toMatchObject({ fields: ["first_name", "email"], ids: 1 })
  })
  it("refuses an id that is not a request id before it reaches the app", async () => {
    await expect(getPrivacyRequest(admin, "../admin/users")).rejects.toMatchObject({ status: 404 })
    await expect(actOnPrivacyRequest(admin, "x", { action: "access" })).rejects.toMatchObject({ status: 404 })
    expect(state.calls).toHaveLength(0)
  })
  it("passes the app's error, including not-yet-available, to the screen", async () => {
    state.status = 501; state.body = { error: "Erasure arrives with the next release." }
    await expect(actOnPrivacyRequest(root, id, { action: "erase" })).rejects.toMatchObject({ status: 501, message: "Erasure arrives with the next release." })
    expect(state.audits).toHaveLength(0)
  })
  it("the relay allows exactly the list and one record by id", async () => {
    const { isProxyAllowed } = await vi.importActual<typeof import("./anker-proxy")>("./anker-proxy")
    expect(isProxyAllowed("admin/privacy-requests")).toBe(true); expect(isProxyAllowed(`admin/privacy-requests/${id}`)).toBe(true)
    expect(isProxyAllowed("admin/privacy-requests/../users")).toBe(false); expect(isProxyAllowed(`admin/privacy-requests/${id}/x`)).toBe(false); expect(isProxyAllowed("admin/privacy-requests/short")).toBe(false)
  })
})
