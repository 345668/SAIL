import { describe, it, expect, vi, beforeEach } from "vitest"
const st = vi.hoisted(() => ({ calls: [] as any[], status: 200, body: {} as any }))
vi.mock("./anker-proxy", () => ({ forwardToAnker: async (i: any) => { st.calls.push(i); return new Response(JSON.stringify(st.body), { status: st.status }) }, isProxyAllowed: () => true }))
import { drillOverview, daysSince } from "./restore-drill"
beforeEach(() => { st.calls = []; st.status = 200; st.body = { drills: [], lastPassedAt: null, overdueAfterDays: 100 } })
describe("restore drill in SAIL", () => {
  it("reads the drills from the app as the staff member, and says plainly when it cannot", async () => {
    expect((await drillOverview({ email: "a@x.test" } as any)).overdueAfterDays).toBe(100); expect(st.calls[0]).toMatchObject({ path: "admin/restore-drill", method: "GET", staffEmail: "a@x.test" })
    st.status = 503; st.body = { error: "The drill record could not be read." }; await expect(drillOverview({ email: "a@x.test" } as any)).rejects.toThrow(/could not be read/)
  })
  it("counts whole days, and null for none", () => { expect(daysSince(null)).toBeNull(); expect(daysSince("2026-01-01T00:00:00Z", Date.parse("2026-01-11T12:00:00Z"))).toBe(10) })
  it("the route is on the relay's allow-list", async () => { const real = await vi.importActual<any>("./anker-proxy"); expect(real.isProxyAllowed("admin/restore-drill")).toBe(true) })
})
