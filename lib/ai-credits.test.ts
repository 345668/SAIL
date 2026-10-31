import { describe, it, expect, vi, beforeEach } from "vitest"
const st = vi.hoisted(() => ({ calls: [] as any[], audits: [] as any[], status: 200, body: {} as any }))
vi.mock("./anker-proxy", () => ({ forwardToAnker: async (i: any) => { st.calls.push(i); return new Response(JSON.stringify(st.body), { status: st.status }) }, isProxyAllowed: () => true }))
vi.mock("./audit", () => ({ audit: async (action: string, who: any, target: any, detail: any) => { st.audits.push({ action, who: who.email, target, detail }) } }))
import { creditsOf, grantCredits, adjustCredits, ADMIN_GRANT_CEILING_USD } from "./ai-credits"
const admin = { email: "a@x.test", role: "admin" } as any, boss = { email: "b@x.test", role: "superadmin" } as any, staff = { email: "s@x.test", role: "staff" } as any
beforeEach(() => { st.calls = []; st.audits = []; st.status = 200; st.body = { ok: true } })
describe("AI credits in SAIL", () => {
  it("reads one workspace's ledger as the staff member and reports not-found plainly", async () => {
    await creditsOf(staff, "org 1"); expect(st.calls[0]).toMatchObject({ path: "admin/credits", method: "GET", search: "?org=org%201", staffEmail: "s@x.test" })
    st.status = 404; st.body = { error: "No such workspace." }; await expect(creditsOf(staff, "x")).rejects.toThrow(/No such workspace/)
  })
  it("a grant needs an admin, a sensible amount and a reason; it is sent to the app and audited with the reason", async () => {
    await expect(grantCredits(staff, "o", 10, null, "a good reason")).rejects.toThrow(/Only admins/); await expect(grantCredits(admin, "o", 0, null, "a good reason")).rejects.toThrow(/more than \$0/); await expect(grantCredits(admin, "o", 10, null, "no")).rejects.toThrow(/reason/)
    await grantCredits(admin, "o", 25, 90, "Pack bought by invoice 2026-114"); expect(st.calls[0]).toMatchObject({ method: "POST", path: "admin/credits" }); expect(JSON.parse(st.calls[0].body)).toEqual({ orgId: "o", action: "grant", amountUsd: 25, expiresInDays: 90, reason: "Pack bought by invoice 2026-114" })
    expect(st.audits).toEqual([{ action: "platform.ai_credit.grant", who: "a@x.test", target: "o", detail: { amountUsd: 25, expiresInDays: 90, reason: "Pack bought by invoice 2026-114" } }])
  })
  it("above the admin ceiling a superadmin is needed, for grants and adjustments", async () => {
    await expect(grantCredits(admin, "o", ADMIN_GRANT_CEILING_USD + 1, null, "a big pack")).rejects.toThrow(/superadmin/); await grantCredits(admin, "o", ADMIN_GRANT_CEILING_USD, null, "at the ceiling"); await grantCredits(boss, "o", 5000, null, "an enterprise pack")
    await expect(adjustCredits(admin, "o", -600, "a big refund")).rejects.toThrow(/superadmin/); await adjustCredits(boss, "o", -600, "a big refund"); expect(st.audits.map((a) => a.action)).toEqual(["platform.ai_credit.grant", "platform.ai_credit.grant", "platform.ai_credit.adjust"])
  })
  it("a refused call is never audited as done", async () => { st.status = 400; st.body = { error: "That would take the balance below zero." }; await expect(adjustCredits(admin, "o", -5, "a refund now")).rejects.toThrow(/below zero/); expect(st.audits).toEqual([]) })
  it("the route is on the relay's allow-list", async () => { const real = await vi.importActual<any>("./anker-proxy"); expect(real.isProxyAllowed("admin/credits")).toBe(true) })
})
