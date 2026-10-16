import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ session: { id: "s1", email: "ed@sail.test", role: "admin" } as any, settings: null as any, keyRows: [] as any[], audit: [] as any[] }))
vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }))
vi.mock("@/lib/crypto", () => ({ decryptSecret: (c: string) => c.replace(/^enc:/, "") }))
vi.mock("@/lib/config-crypto", () => ({ decryptSecret: (c: string) => c.replace(/^cfg:/, "") }))
vi.mock("@/lib/news/ingest", () => ({ gatherSources: async () => [] }))
vi.mock("@/lib/db", () => ({
  sql: async (p: TemplateStringsArray, ...v: unknown[]) => {
    const q = p.join("?")
    if (q.includes("system_settings")) return state.settings ? [{ value: state.settings }] : []
    if (q.includes("platform_api_keys")) return state.keyRows
    if (q.includes("company_audit_log")) { state.audit.push(v); return [] }
    return []
  },
}))
import { POST } from "./route"
import { _resetSkillCache } from "@/lib/newsroom-skill"
import { clearExhausted } from "@/lib/qwen-lanes"

const EM = "—"
const FREE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions"
const PLAN = "https://coding-intl.dashscope.aliyuncs.com/v1/chat/completions"
const post = (body: unknown = { topic: "LP sentiment in H2" }) => new Request("https://sail.test/api/newsroom/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
const err = (status: number, message: string, code = "") => new Response(JSON.stringify({ error: { message, code } }), { status })
const article = (over: object = {}) => JSON.stringify({ headline: `Funds raised less ${EM} again`, subheadline: "LPs paused", content: `## The numbers\n\nCommitments fell ${EM} a delve into the data.`, suggestedTags: ["Funds"], sentiment: "bearish", ...over })
const calls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map(([u, i]) => ({ url: String(u), body: JSON.parse((i as any).body), auth: (i as any).headers.authorization as string }))

beforeEach(() => {
  state.settings = { qwenFreeApiKey: "cfg:free-key", qwenPlanApiKey: "cfg:sk-sp-plan-key" }
  state.keyRows = []; state.audit = []; state.session = { id: "s1", email: "ed@sail.test", role: "admin" }
  _resetSkillCache(); clearExhausted()
  for (const k of ["QWEN_FREE_API_KEY", "QWEN_PLAN_API_KEY", "DASHSCOPE_API_KEY", "QWEN_API_KEY", "QWEN_BASE_URL", "QWEN_REGION", "QWEN_WORKSPACE_ID", "NEWSROOM_QWEN_MODELS", "QWEN_PLAN_MODEL_BALANCED"]) vi.stubEnv(k, "")
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe("the newsroom draft route", () => {
  it("needs a signed-in member of staff and a topic", async () => {
    state.session = null
    expect((await POST(post())).status).toBe(401)
    state.session = { id: "s1", email: "ed@sail.test", role: "admin" }
    expect((await POST(post({ topic: " " }))).status).toBe(400)
  })
  it("says what to configure when no Qwen key exists, and calls nothing", async () => {
    state.settings = null
    const f = vi.fn(); vi.stubGlobal("fetch", f)
    const r = await POST(post())
    expect(r.status).toBe(412)
    expect((await r.json()).error).toMatch(/No Qwen key is configured.*AI configuration page/)
    expect(f).not.toHaveBeenCalled()
  })
  it("drafts on the free lane first, free-tier model, skill as the system prompt, thinking off", async () => {
    const f = vi.fn().mockResolvedValue(ok(article())); vi.stubGlobal("fetch", f)
    const r = await POST(post({ topic: "LP sentiment in H2", lengthHint: "short", blogType: "Insights" }))
    expect(r.status).toBe(200)
    const [c] = calls(f)
    expect(f).toHaveBeenCalledTimes(1)
    expect(c.url).toBe(FREE)
    expect(c.auth).toBe("Bearer free-key")
    expect(c.body.model).toBe("qwen3.7-plus")
    expect(c.body.enable_thinking).toBe(false)
    expect(c.body.temperature).toBe(0.4)
    expect(c.body.messages[0].content).toContain("Never use em dashes")
    expect(c.body.messages[0].content).toContain("Target about 500 words")
    expect(c.body.messages[1].content).toContain("LP sentiment in H2")
  })
  it("moves to the next free model when one's free allowance is spent", async () => {
    const f = vi.fn().mockResolvedValueOnce(err(403, "The free allocated quota has been exhausted", "AllocationQuota.FreeTierOnly")).mockResolvedValueOnce(ok(article()))
    vi.stubGlobal("fetch", f)
    expect((await POST(post())).status).toBe(200)
    expect(calls(f).map((c) => c.body.model)).toEqual(["qwen3.7-plus", "qwen3.6-plus"])
    expect(calls(f).every((c) => c.url === FREE)).toBe(true)
  })
  it("falls back to the token-plan lane, on its own endpoint and key, when every free model is spent", async () => {
    const spent = () => err(403, "free tier only", "AllocationQuota.FreeTierOnly")
    const f = vi.fn().mockImplementation(async (u: string) => (String(u) === FREE ? spent() : ok(article()))); vi.stubGlobal("fetch", f)
    const j = await (await POST(post())).json()
    const all = calls(f)
    expect(all.filter((c) => c.url === FREE).map((c) => c.body.model)).toEqual(["qwen3.7-plus", "qwen3.6-plus", "qwen3.5-plus", "qwen-plus"])
    const last = all.at(-1)!
    expect(last).toMatchObject({ url: PLAN, auth: "Bearer sk-sp-plan-key" })
    expect(last.body.model).toBe("qwen3.6-plus")
    expect(j.headline).toBe("Funds raised less, again")
    const detail = JSON.parse(String(state.audit[0].at(-1)))
    expect(detail).toMatchObject({ provider: "qwen", lane: "plan", model: "qwen3.6-plus", skill: "newsroom-writer" })
  })
  it("a refused free key (wrong region or revoked) goes straight to the plan lane", async () => {
    const f = vi.fn().mockImplementation(async (u: string) => (String(u) === FREE ? err(401, "Incorrect API key provided") : ok(article()))); vi.stubGlobal("fetch", f)
    expect((await POST(post())).status).toBe(200)
    expect(calls(f).filter((c) => c.url === FREE)).toHaveLength(1)
    expect(calls(f).at(-1)!.url).toBe(PLAN)
  })
  it("uses a token-plan key stored in the platform keys table as the backup", async () => {
    state.settings = { qwenFreeApiKey: "cfg:free-key" }
    state.keyRows = [{ secret_cipher: "enc:sk-sp-from-table" }]
    const f = vi.fn().mockImplementation(async (u: string) => (String(u) === FREE ? err(429, "Throttling.AllocationQuota free allocated quota exceeded") : ok(article()))); vi.stubGlobal("fetch", f)
    expect((await POST(post())).status).toBe(200)
    expect(calls(f).at(-1)).toMatchObject({ url: PLAN, auth: "Bearer sk-sp-from-table" })
  })
  it("names both lanes when neither can draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(401, "Incorrect API key provided")))
    const r = await POST(post())
    const j = await r.json()
    expect(r.status).toBe(502)
    expect(j.error).toMatch(/free lane: the key was refused/)
    expect(j.error).toMatch(/plan lane: the key was refused/)
    expect(j.error).toMatch(/AI configuration page/)
    expect(JSON.stringify(j)).not.toMatch(/free-key|sk-sp-plan-key/)
  })
  it("reads JSON that the model wrapped in a code fence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok("```json\n" + article() + "\n```")))
    expect((await (await POST(post())).json()).headline).toBe("Funds raised less, again")
  })
  it("removes dashes the model slipped in and reports what is left to judge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(article())))
    const j = await (await POST(post())).json()
    expect(j.content).not.toMatch(/[–—]/)
    expect(j.style).toMatchObject({ dashesRemoved: 2, headlineTooLong: false })
    expect(j.style.bannedFound).toContain("delve")
    expect(j.suggestedTags).toEqual(["funds"])
    expect(j.sentiment).toBe("bearish")
  })
  it("a model that did not return JSON still yields a cleaned draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok(`Plain text ${EM} not JSON`)))
    expect((await (await POST(post())).json()).content).toBe("Plain text, not JSON")
  })
})
