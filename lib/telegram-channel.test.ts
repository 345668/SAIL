import { describe, it, expect, vi, beforeEach } from "vitest"
const state = vi.hoisted(() => ({ calls: [] as any[], status: 200, body: {} as any, audits: [] as any[] }))
vi.mock("./anker-proxy", () => ({ forwardToAnker: async (i: any) => { state.calls.push(i); return new Response(JSON.stringify(state.body), { status: state.status }) } }))
vi.mock("./audit", () => ({ audit: async (...a: any[]) => { state.audits.push(a) } }))
import { channelStatus, setWebhook } from "./telegram-channel"
import { ControlError } from "./tenant-control"

const admin = { id: "a", email: "admin@sail.test", role: "admin" as const }, staff = { id: "s", email: "staff@sail.test", role: "staff" as const }
const fail = async (p: Promise<unknown>) => p.then(() => null, (e) => e as ControlError)
beforeEach(() => { state.calls.length = 0; state.audits.length = 0; state.status = 200; state.body = {} })
describe("the Telegram channel, operator side", () => {
  it("reads the status through the relay", async () => {
    state.body = { configured: true, flagOn: false, bot: "AnkerBot", queue: [], links: [] }
    expect((await channelStatus(staff)).bot).toBe("AnkerBot"); expect(state.calls[0]).toMatchObject({ path: "admin/telegram-channel", method: "GET" })
  })
  it("only admins register or remove the webhook, and the action is audited without anything secret", async () => {
    expect((await fail(setWebhook(staff, "register")))?.status).toBe(403)
    expect(await fail(setWebhook(admin, "nuke" as any))).toBeInstanceOf(ControlError)
    await setWebhook(admin, "register")
    expect(state.calls.at(-1)).toMatchObject({ method: "POST", path: "admin/telegram-channel", staffEmail: "admin@sail.test" }); expect(JSON.parse(state.calls.at(-1).body)).toEqual({ action: "register" })
    expect(state.audits[0][0]).toBe("platform.telegram_webhook.register")
  })
  it("passes the app's error to the screen and does not audit a failure", async () => {
    state.status = 503; state.body = { error: "The product bot is not configured." }
    await expect(setWebhook(admin, "register")).rejects.toThrow(/not configured/); expect(state.audits).toHaveLength(0)
  })
})
