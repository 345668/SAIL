import { describe, it, expect, vi, beforeEach } from "vitest"
const st = vi.hoisted(() => ({ calls: [] as any[], audits: [] as any[], status: 200, body: {} as any }))
vi.mock("./anker-proxy", () => ({ forwardToAnker: async (i: any) => { st.calls.push(i); return new Response(JSON.stringify(st.body), { status: st.status }) } }))
vi.mock("./audit", () => ({ audit: async (action: string, who: any, target: any, detail: any) => { st.audits.push({ action, who: who.email, target, detail }) } }))
import { devicesOf, listConnections, removeConnection, revokeDevice } from "./telegram-channel"
import { ControlError } from "./tenant-control"

const admin = { id: "a1", email: "admin@sail.test", role: "admin" as const }, staff = { id: "s1", email: "staff@sail.test", role: "staff" as const }
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as ControlError)
beforeEach(() => { st.calls.length = 0; st.audits.length = 0; st.status = 200; st.body = {} })

describe("supervising customers' Telegram connections", () => {
  it("lists connections (with a health check by default) and a bot's devices through the relay", async () => {
    st.body = { connections: [{ botId: "b1" }], devices: [{ id: "d1" }] }
    expect(await listConnections(staff)).toEqual([{ botId: "b1" }]); expect(st.calls[0]).toMatchObject({ path: "admin/telegram-channel", method: "GET", search: "?connections=1&check=1", staffEmail: "staff@sail.test" })
    await listConnections(staff, false); expect(st.calls[1].search).toBe("?connections=1")
    expect(await devicesOf(staff, "b1")).toEqual([{ id: "d1" }]); expect(st.calls[2].search).toBe("?devices=b1")
  })
  it("only an admin can remove a connection or a device, and a reason is required; the removal is audited with who and why", async () => {
    expect((await fail(removeConnection(staff, "b1", "a good reason")))?.status).toBe(403); expect((await fail(revokeDevice(staff, "d1", "a good reason")))?.status).toBe(403)
    expect((await fail(removeConnection(admin, "b1", " no ")))?.message).toMatch(/reason/); expect(st.calls).toHaveLength(0)
    st.body = { ok: true, devices: 3 }
    expect(await removeConnection(admin, "b1", "  Customer   asked us to remove it ")).toBe(3)
    expect(st.calls[0]).toMatchObject({ method: "POST" }); expect(JSON.parse(st.calls[0].body)).toEqual({ action: "disconnect_bot", botId: "b1", reason: "Customer asked us to remove it" })
    expect(st.audits[0]).toEqual({ action: "platform.telegram_connection.remove", who: "admin@sail.test", target: "b1", detail: { reason: "Customer asked us to remove it", devices: 3 } })
    await revokeDevice(admin, "d9", "Lost phone reported"); expect(JSON.parse(st.calls[1].body)).toEqual({ action: "revoke_link", linkId: "d9", reason: "Lost phone reported" }); expect(st.audits[1]).toMatchObject({ action: "platform.telegram_device.revoke", target: "d9" })
  })
  it("a refusal from the app is shown, and nothing is audited as done", async () => {
    st.status = 404; st.body = { error: "That connection no longer exists." }
    expect((await fail(removeConnection(admin, "b1", "a good reason")))?.message).toBe("That connection no longer exists."); expect(st.audits).toHaveLength(0)
  })
})
