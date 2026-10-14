import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ session: { id: "s1", email: "ed@sail.test", role: "admin" } as any, keyRows: [] as any[], audit: [] as any[] }))
vi.mock("@/lib/auth", () => ({ getSession: async () => state.session }))
vi.mock("@/lib/crypto", () => ({ decryptSecret: (c: string) => c.replace(/^enc:/, "") }))
vi.mock("@/lib/news/ingest", () => ({ gatherSources: async () => [] }))
vi.mock("@/lib/db", () => ({
  sql: async (p: TemplateStringsArray, ...v: unknown[]) => {
    const q = p.join("?")
    if (q.includes("platform_api_keys")) return state.keyRows
    if (q.includes("company_audit_log")) { state.audit.push(v); return [] }
    return []
  },
}))
import { POST } from "./route"
import { _resetSkillCache } from "@/lib/newsroom-skill"

const EM = "—"
const post = (body: unknown = { topic: "LP sentiment in H2" }) => new Request("https://sail.test/api/newsroom/draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const mistral = (content: string, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status }))
const article = (over: object = {}) => JSON.stringify({ headline: `Funds raised less ${EM} again`, subheadline: "LPs paused", content: `## The numbers\n\nCommitments fell ${EM} a delve into the data.`, suggestedTags: ["Funds"], sentiment: "bearish", ...over })

beforeEach(() => { state.keyRows = []; state.audit = []; state.session = { id: "s1", email: "ed@sail.test", role: "admin" }; _resetSkillCache(); vi.stubEnv("MISTRAL_API_KEY", "") })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe("the newsroom draft route", () => {
  it("needs a signed-in member of staff and a topic", async () => {
    state.session = null
    expect((await POST(post())).status).toBe(401)
    state.session = { id: "s1", email: "ed@sail.test", role: "admin" }
    expect((await POST(post({ topic: " " }))).status).toBe(400)
  })
  it("asks for a Mistral key, not an Anthropic one, when none is stored", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f)
    const r = await POST(post())
    const j = await r.json()
    expect(r.status).toBe(412)
    expect(j.error).toBe("No active Mistral platform key. Add one under Platform API keys (provider: mistral), then retry.")
    expect(j.error).not.toMatch(/anthropic/i)
    expect(f).not.toHaveBeenCalled()
  })
  it("calls Mistral with the stored key, the skill as the system prompt, and JSON output", async () => {
    state.keyRows = [{ secret_cipher: "enc:mk-live" }]
    const f = mistral(article()); vi.stubGlobal("fetch", f)
    const r = await POST(post({ topic: "LP sentiment in H2", lengthHint: "short", blogType: "Insights" }))
    expect(r.status).toBe(200)
    const [url, init] = f.mock.calls[0] as [string, any]
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions")
    expect(init.headers.authorization).toBe("Bearer mk-live")
    const body = JSON.parse(init.body)
    expect(body.model).toBe("mistral-large-latest")
    expect(body.response_format).toEqual({ type: "json_object" })
    expect(body.temperature).toBe(0.4)
    expect(body.messages[0].role).toBe("system")
    expect(body.messages[0].content).toContain("Never use em dashes")
    expect(body.messages[0].content).toContain("# This piece")
    expect(body.messages[0].content).toContain("Target about 500 words")
    expect(body.messages[1].content).toContain("LP sentiment in H2")
    expect(f.mock.calls.some(([u]) => String(u).includes("anthropic"))).toBe(false)
  })
  it("removes dashes the model slipped in and reports what is left to judge", async () => {
    state.keyRows = [{ secret_cipher: "enc:mk" }]
    vi.stubGlobal("fetch", mistral(article()))
    const j = await (await POST(post())).json()
    expect(j.headline).toBe("Funds raised less, again")
    expect(j.content).not.toMatch(/[–—]/)
    expect(j.style).toMatchObject({ dashesRemoved: 2, headlineTooLong: false })
    expect(j.style.bannedFound).toContain("delve")
    expect(j.suggestedTags).toEqual(["funds"])
    expect(j.sentiment).toBe("bearish")
  })
  it("falls back to the environment key", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "mk-env")
    const f = mistral(article()); vi.stubGlobal("fetch", f)
    expect((await POST(post())).status).toBe(200)
    expect((f.mock.calls[0][1] as any).headers.authorization).toBe("Bearer mk-env")
  })
  it("a stored key that cannot be decrypted falls back to the environment, not to a crash", async () => {
    state.keyRows = [{ secret_cipher: null }]
    vi.stubEnv("MISTRAL_API_KEY", "mk-env")
    vi.stubGlobal("fetch", mistral(article()))
    expect((await POST(post())).status).toBe(200)
  })
  it("reports a provider refusal as 502 with Mistral named, and a model that did not return JSON still yields a cleaned draft", async () => {
    state.keyRows = [{ secret_cipher: "enc:mk" }]
    vi.stubGlobal("fetch", mistral("rate limited", 429))
    const bad = await POST(post())
    expect(bad.status).toBe(502)
    expect((await bad.json()).error).toMatch(/^Mistral 429/)
    vi.stubGlobal("fetch", mistral(`Plain text ${EM} not JSON`))
    const j = await (await POST(post())).json()
    expect(j.content).toBe("Plain text, not JSON")
  })
  it("records the draft in the audit log with the model and the skill used", async () => {
    state.keyRows = [{ secret_cipher: "enc:mk" }]
    vi.stubGlobal("fetch", mistral(article()))
    await POST(post())
    const detail = JSON.parse(String(state.audit[0].at(-1)))
    expect(detail).toMatchObject({ model: "mistral-large-latest", skill: "newsroom-writer" })
  })
  it("sends a named user agent", async () => {
    state.keyRows = [{ secret_cipher: "enc:mk" }]
    const f = mistral(article()); vi.stubGlobal("fetch", f)
    await POST(post())
    expect((f.mock.calls[0][1] as any).headers["user-agent"]).toMatch(/^Anker-SAIL/)
  })
  it("explains a 403 with Mistral's own message and the usual causes", async () => {
    state.keyRows = [{ secret_cipher: "enc:mk" }]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "Forbidden: organization not allowed", request_id: "r1" }), { status: 403 })))
    const j = await (await POST(post())).json()
    expect(j.error).toContain("Mistral 403: Forbidden: organization not allowed")
    expect(j.error).toMatch(/revoked|restricted|no active plan/)
    expect(j.error).toMatch(/Platform API keys/)
  })
  it("tells a Cloudflare block from an API answer", async () => {
    state.keyRows = [{ secret_cipher: "enc:mk" }]
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html><title>Attention Required! | Cloudflare</title></html>", { status: 403 })))
    const j = await (await POST(post())).json()
    expect(j.error).toMatch(/^Mistral 403\. Mistral's edge network blocked/)
  })
  it("names each common status", async () => {
    const { mistralProblem } = await import("@/lib/mistral-errors")
    expect(mistralProblem(401, "{}")).toMatch(/not recognised/)
    expect(mistralProblem(429, '{"message":"rate"}')).toMatch(/rate limited/)
    expect(mistralProblem(404, "")).toMatch(/NEWSROOM_MISTRAL_MODEL/)
    expect(mistralProblem(500, "oops")).toBe("Mistral 500: oops")
  })
})
