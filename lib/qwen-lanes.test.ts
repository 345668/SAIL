import { beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("@/lib/db", () => ({ sql: async () => [] }))
import { buildLanes, classify, clearExhausted, complete, describeFailure, freeAllowanceSpent, isPlanKey, standardBase, FREE_MODELS, PLAN_MODELS, QwenFailure, type Lane } from "./qwen-lanes"

const lane = (id: "free" | "plan", models = ["m1", "m2"]): Lane => ({ id, key: `${id}-key`, baseUrl: `https://${id}.test/v1`, models })
const ok = (c = "hello") => new Response(JSON.stringify({ choices: [{ message: { content: c } }] }), { status: 200 })
const bad = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status })
const req = { system: "s", user: "u", temperature: 0.4, maxTokens: 100 }
beforeEach(() => clearExhausted())

describe("building the lanes", () => {
  it("a free key and a plan key make two lanes, free first, with their own endpoints and model lists", () => {
    const l = buildLanes({ freeKey: "k-free", planKey: "sk-sp-plan" }, [], {})
    expect(l.map((x) => x.id)).toEqual(["free", "plan"])
    expect(l[0]).toMatchObject({ key: "k-free", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", models: FREE_MODELS })
    expect(l[1]).toMatchObject({ key: "sk-sp-plan", baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1", models: PLAN_MODELS })
  })
  it("takes keys from the saved configuration, then the environment, then the stored keys, in the app's order", () => {
    expect(buildLanes({ freeKey: "cfg-free", standardKey: "cfg-std" }, ["stored"], { QWEN_FREE_API_KEY: "env-free" })[0].key).toBe("env-free")
    expect(buildLanes({ freeKey: "cfg-free", standardKey: "cfg-std" }, ["stored"], {})[0].key).toBe("cfg-free")
    expect(buildLanes({ standardKey: "cfg-std" }, ["stored"], {})[0].key).toBe("cfg-std")
    expect(buildLanes({}, ["stored"], { DASHSCOPE_API_KEY: "d" })[0].key).toBe("stored")
    expect(buildLanes({}, [], { DASHSCOPE_API_KEY: "d", QWEN_API_KEY: "q" })[0].key).toBe("d")
  })
  it("a token-plan key (sk-sp-) is only ever the plan lane, wherever it was saved", () => {
    expect(isPlanKey("sk-sp-abc")).toBe(true)
    expect(isPlanKey("sk-abc")).toBe(false)
    expect(buildLanes({ standardKey: "sk-sp-only" }, [], {}).map((x) => x.id)).toEqual(["plan"])
    expect(buildLanes({}, ["sk-sp-first", "sk-free"], {}).map((x) => [x.id, x.key])).toEqual([["free", "sk-free"], ["plan", "sk-sp-first"]])
  })
  it("the plan key from the environment beats the saved one; no keys, no lanes", () => {
    expect(buildLanes({ planKey: "sk-sp-cfg" }, [], { QWEN_PLAN_API_KEY: "sk-sp-env" })[0].key).toBe("sk-sp-env")
    expect(buildLanes({}, [], {})).toEqual([])
  })
  it("resolves the endpoint like the app: explicit URL, workspace host, region, else international", () => {
    expect(standardBase({}, { QWEN_BASE_URL: "https://proxy.test/v1/" })).toBe("https://proxy.test/v1")
    expect(standardBase({ workspaceId: "ws-123" }, {})).toBe("https://ws-123.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1")
    expect(standardBase({ workspaceId: "intl" }, {})).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
    expect(standardBase({ region: "Virginia" }, {})).toBe("https://dashscope-us.aliyuncs.com/compatible-mode/v1")
    expect(standardBase({}, { QWEN_REGION: "cn" })).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1")
    expect(standardBase({}, {})).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")
  })
  it("model lists can be overridden from the environment", () => {
    const l = buildLanes({ freeKey: "k", planKey: "sk-sp-p" }, [], { NEWSROOM_QWEN_MODELS: "qwen-flash, qwen-turbo", QWEN_PLAN_MODEL_BALANCED: "qwen3.7-plus" })
    expect(l[0].models).toEqual(["qwen-flash", "qwen-turbo"])
    expect(l[1].models).toEqual(["qwen3.7-plus"])
  })
})

describe("reading an answer", () => {
  it("tells a spent free allowance from a plain rate limit", () => {
    expect(freeAllowanceSpent(403, "AllocationQuota.FreeTierOnly: the free tier of this model is exhausted")).toBe(true)
    expect(freeAllowanceSpent(429, "Throttling.AllocationQuota free allocated quota exceeded")).toBe(true)
    expect(freeAllowanceSpent(429, "Throttling.RateQuota Requests rate limit exceeded")).toBe(false)
    expect(freeAllowanceSpent(500, "free tier")).toBe(false)
  })
  it("classifies each outcome", () => {
    expect(classify(200, "")).toBe("ok")
    expect(classify(401, "Incorrect API key")).toBe("lane_refused")
    expect(classify(403, "AllocationQuota.FreeTierOnly")).toBe("model_exhausted")
    expect(classify(400, "enable_thinking is not supported")).toBe("retry_without_thinking")
    expect(classify(429, "Requests rate limit exceeded")).toBe("try_next")
    expect(classify(500, "oops")).toBe("try_next")
  })
})

describe("completing", () => {
  it("answers from the first model that works", async () => {
    const f = vi.fn().mockResolvedValue(ok("draft")) as any
    const r = await complete([lane("free"), lane("plan")], req, { fetchImpl: f })
    expect(r).toMatchObject({ text: "draft", lane: "free", model: "m1" })
    expect(f).toHaveBeenCalledTimes(1)
  })
  it("sends thinking off for the hybrid Qwen3.x models only, and retries without it if the model objects", async () => {
    const f = vi.fn().mockResolvedValueOnce(bad(400, "Parameter enable_thinking is invalid")).mockResolvedValueOnce(ok("draft")) as any
    await complete([lane("free", ["qwen3.6-plus"])], req, { fetchImpl: f })
    expect(JSON.parse(f.mock.calls[0][1].body).enable_thinking).toBe(false)
    expect(JSON.parse(f.mock.calls[1][1].body).enable_thinking).toBeUndefined()
    const g = vi.fn().mockResolvedValue(ok()) as any
    await complete([lane("free", ["qwen-plus"])], req, { fetchImpl: g })
    expect(JSON.parse(g.mock.calls[0][1].body).enable_thinking).toBeUndefined()
  })
  it("remembers a model whose free allowance is spent and skips it next time, but not after a plain rate limit", async () => {
    const f = vi.fn().mockImplementation(async (_u: string, i: any) => (JSON.parse(i.body).model === "m1" ? bad(403, "AllocationQuota.FreeTierOnly") : ok())) as any
    await complete([lane("free")], req, { fetchImpl: f })
    f.mockClear()
    const r = await complete([lane("free")], req, { fetchImpl: f })
    expect(r.attempts[0]).toMatchObject({ model: "m1", status: "skipped" })
    expect(f).toHaveBeenCalledTimes(1)
    clearExhausted()
    const g = vi.fn().mockImplementation(async (_u: string, i: any) => (JSON.parse(i.body).model === "m1" ? bad(429, "Throttling.RateQuota Requests rate limit exceeded") : ok())) as any
    await complete([lane("free")], req, { fetchImpl: g })
    g.mockClear()
    await complete([lane("free")], req, { fetchImpl: g })
    expect(JSON.parse(g.mock.calls[0][1].body).model).toBe("m1")
  })
  it("a refused key ends that lane at once; the other lane is tried", async () => {
    const f = vi.fn().mockImplementation(async (u: string) => (u.startsWith("https://free") ? bad(401, "Incorrect API key") : ok("from plan"))) as any
    const r = await complete([lane("free"), lane("plan")], req, { fetchImpl: f })
    expect(r.lane).toBe("plan")
    expect(f.mock.calls.filter(([u]: [string]) => String(u).startsWith("https://free"))).toHaveLength(1)
  })
  it("a timeout, a network error, a server error and an empty answer each move on to the next model", async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "TimeoutError" }))
      .mockRejectedValueOnce(new Error("socket hang up"))
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(ok("   "))
      .mockResolvedValueOnce(ok("finally")) as any
    const r = await complete([lane("free", ["a", "b", "c", "d", "e"])], req, { fetchImpl: f })
    expect(r.text).toBe("finally")
    expect(r.attempts.map((a) => a.status)).toEqual(["timeout", "network", 500, 200, 200])
  })
  it("stops starting new models once the time is up", async () => {
    const f = vi.fn().mockImplementation(async () => bad(500, "slow")) as any
    await expect(complete([lane("free", ["a", "b"])], req, { fetchImpl: f, deadlineMs: -1 })).rejects.toThrow(QwenFailure)
    expect(f).not.toHaveBeenCalled()
  })
  it("fails with a message per lane and never includes a key", async () => {
    const f = vi.fn().mockImplementation(async () => bad(403, "Access denied for this model")) as any
    const err: QwenFailure = await complete([lane("free"), lane("plan")], req, { fetchImpl: f }).catch((e) => e)
    expect(err).toBeInstanceOf(QwenFailure)
    expect(err.message).toMatch(/free lane: 403 Access denied for this model; plan lane: 403 Access denied/)
    expect(err.message + JSON.stringify(err.attempts)).not.toMatch(/free-key|plan-key/)
    expect(await complete([], req).catch((e) => e.message)).toBe("No Qwen key is configured.")
  })
  it("describes a refused key with the region hint", () => {
    expect(describeFailure([lane("free")], [{ lane: "free", model: "m1", status: 401, note: "" }])).toMatch(/region that issued it/)
  })
})
