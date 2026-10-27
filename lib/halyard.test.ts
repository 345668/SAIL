import { describe, it, expect, vi, beforeEach } from "vitest"
const st = vi.hoisted(() => ({ calls: [] as any[], audits: [] as any[], flags: [] as any[], status: 200, body: {} as any }))
vi.mock("./anker-proxy", () => ({ forwardToAnker: async (i: any) => { st.calls.push(i); return new Response(JSON.stringify(st.body), { status: st.status }) }, isProxyAllowed: () => true }))
vi.mock("./audit", () => ({ audit: async (action: string, who: any, target: any, detail: any) => { st.audits.push({ action, who: who.email, target, detail }) } }))
vi.mock("./tenant-control", async () => { const real = await vi.importActual<any>("./tenant-control"); return { ...real, setFlag: async (_s: any, i: any) => { st.flags.push(i) } } })
import { halyardOverview, setHalyardSwitch } from "./halyard"
import { isProxyAllowed } from "./anker-proxy"

const admin = { email: "a@x.test", role: "admin" } as any, viewer = { email: "v@x.test", role: "viewer" } as any
beforeEach(() => { st.calls = []; st.audits = []; st.flags = []; st.status = 200; st.body = { flagOn: true, workspaces: [] } })

describe("Halyard in SAIL", () => {
  it("reads the overview from the app as the staff member and shows an error plainly", async () => {
    expect((await halyardOverview(admin)).flagOn).toBe(true); expect(st.calls[0]).toMatchObject({ path: "admin/halyard", method: "GET", staffEmail: "a@x.test" })
    st.status = 503; st.body = { error: "Halyard's tables could not be read." }; await expect(halyardOverview(admin)).rejects.toThrow(/could not be read/)
  })
  it("the kill switch needs an admin and a reason, sets the platform flag, and is audited", async () => {
    await expect(setHalyardSwitch(viewer, false, "because reasons")).rejects.toThrow(/Only admins/)
    await setHalyardSwitch(admin, false, "transcription provider is down")
    expect(st.flags).toEqual([{ key: "halyard_web", enabled: false, rolloutPct: 100, reason: "transcription provider is down" }])
    expect(st.audits).toEqual([{ action: "platform.halyard.off", who: "a@x.test", target: "halyard_web", detail: { reason: "transcription provider is down" } }])
    await setHalyardSwitch(admin, true, "provider is back"); expect(st.audits[1].action).toBe("platform.halyard.on")
  })
  it("the page's route is on the relay's allow-list", async () => { const real = await vi.importActual<any>("./anker-proxy"); expect(real.isProxyAllowed("admin/halyard")).toBe(true); expect(real.isProxyAllowed("admin/halyard/../x")).toBe(false); void isProxyAllowed })
})
