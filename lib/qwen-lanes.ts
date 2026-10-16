import { sql } from "./db"
import { decryptSecret as decryptPortal } from "./crypto"
import { decryptSecret as decryptConfig } from "./config-crypto"

/**
 * Qwen for the portal's own writing (the newsroom), with the same two lanes the Anker app uses (Anker docs/architecture/35):
 *
 *   free lane  the pay-as-you-go key, on the standard endpoint, FREE-TIER models only, so nothing is billed without being asked for
 *   plan lane  the token-plan key (sk-sp-...), on its own endpoint and its own short list of models, used when the free lane cannot answer
 *
 * Inside a lane each model is tried in turn; one whose free allowance is spent is remembered for a while and skipped. Keys come from the AI
 * configuration page (system_settings 'ai_router_v1'), then the environment, then the platform keys table, in that order.
 */
export const FREE_MODELS = ["qwen3.7-plus", "qwen3.6-plus", "qwen3.5-plus", "qwen-plus"]
export const PLAN_MODELS = ["qwen3.6-plus", "qwen3.5-plus"]
export const PLAN_BASE = "https://coding-intl.dashscope.aliyuncs.com/v1"
const REGION_BASE: Record<string, string> = {
  intl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  us: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
  cn: "https://dashscope.aliyuncs.com/compatible-mode/v1",
}
const REGION_ALIAS: Record<string, string> = { intl: "intl", international: "intl", sg: "intl", singapore: "intl", us: "us", usa: "us", virginia: "us", cn: "cn", china: "cn", beijing: "cn" }

type Env = Record<string, string | undefined>
export const isPlanKey = (k: string | null | undefined) => /^sk-sp-/.test(k ?? "")
const csv = (v: string | undefined) => {
  const l = (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  return l.length ? l : null
}

export interface Lane {
  id: "free" | "plan"
  key: string
  baseUrl: string
  models: string[]
}

export interface QwenConfig {
  freeKey?: string | null
  standardKey?: string | null
  planKey?: string | null
  region?: string | null
  workspaceId?: string | null
}

/** Where the standard endpoint is: an explicit URL, a workspace host, a region, else international. A key only works in the region that issued it. */
export function standardBase(cfg: QwenConfig, env: Env = process.env): string {
  const explicit = env.QWEN_BASE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, "")
  const ws = (cfg.workspaceId || env.QWEN_WORKSPACE_ID || "").trim()
  if (ws && ws.toLowerCase() !== "intl") return `https://${ws}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
  const region = REGION_ALIAS[(cfg.region || env.QWEN_REGION || "").trim().toLowerCase()]
  return REGION_BASE[region ?? "intl"]
}

/**
 * The lanes to try, in order. `keys` are the extra candidates (the platform keys table), tried after the configured and environment ones.
 * A token-plan key (sk-sp-...) can only be the plan lane: on the standard endpoint it is refused.
 */
export function buildLanes(cfg: QwenConfig, keys: string[] = [], env: Env = process.env): Lane[] {
  const candidates = [env.QWEN_FREE_API_KEY?.trim(), cfg.freeKey, cfg.standardKey, ...keys, env.DASHSCOPE_API_KEY?.trim(), env.QWEN_API_KEY?.trim()].filter((k): k is string => !!k)
  const free = candidates.find((k) => !isPlanKey(k)) ?? null
  const plan = env.QWEN_PLAN_API_KEY?.trim() || cfg.planKey || candidates.find(isPlanKey) || null
  const lanes: Lane[] = []
  if (free) lanes.push({ id: "free", key: free, baseUrl: standardBase(cfg, env), models: csv(env.NEWSROOM_QWEN_MODELS) ?? FREE_MODELS })
  if (plan) lanes.push({ id: "plan", key: plan, baseUrl: (env.QWEN_PLAN_BASE_URL?.trim() || PLAN_BASE).replace(/\/+$/, ""), models: csv(env.QWEN_PLAN_MODEL_BALANCED) ?? PLAN_MODELS })
  return lanes
}

/** Reads the saved configuration, the environment and the platform keys into lanes. Never throws: a missing piece just means fewer lanes. */
export async function loadLanes(env: Env = process.env): Promise<Lane[]> {
  let cfg: QwenConfig = {}
  try {
    const row = ((await sql`SELECT value FROM system_settings WHERE key = 'ai_router_v1' LIMIT 1`) as any[])[0]
    const v = typeof row?.value === "string" ? JSON.parse(row.value) : row?.value ?? {}
    const secret = (x: unknown) => (typeof x === "string" && x ? decryptConfig(x) : null)
    cfg = { freeKey: secret(v.qwenFreeApiKey), standardKey: secret(v.qwenApiKey), planKey: secret(v.qwenPlanApiKey), region: v.qwenRegion ?? null, workspaceId: v.qwenWorkspaceId ?? null }
  } catch (e) {
    console.warn("[qwen-lanes] saved configuration unreadable:", (e as Error).message)
  }
  let stored: string[] = []
  try {
    const rows = (await sql`SELECT secret_cipher FROM platform_api_keys WHERE provider = 'qwen' AND NOT disabled ORDER BY created_at DESC`) as any[]
    stored = rows.map((r) => { try { return r.secret_cipher ? decryptPortal(r.secret_cipher) : "" } catch { return "" } }).filter(Boolean)
  } catch {}
  return buildLanes(cfg, stored, env)
}

// ─── what an answer means ────────────────────────────────────────────────
export type Verdict = "ok" | "model_exhausted" | "lane_refused" | "retry_without_thinking" | "try_next"

/** DashScope says a spent free allowance with 403 AllocationQuota.FreeTierOnly or a 429 allocation-quota error; a plain rate limit is transient. */
export function freeAllowanceSpent(status: number, body: string): boolean {
  const e = body.toLowerCase()
  if (/requests rate limit|rate.?quota|too many requests/.test(e) && !/free|allocat/.test(e)) return false
  return /free.?tier|allocation.?quota|free allocated quota|quota.*(exhaust|exceed)|exhaust/.test(e) && (status === 403 || status === 429 || status === 400)
}

export function classify(status: number, body: string): Verdict {
  if (status >= 200 && status < 300) return "ok"
  if (freeAllowanceSpent(status, body)) return "model_exhausted"
  if (status === 401) return "lane_refused"
  if (status === 400 && /enable_thinking/i.test(body)) return "retry_without_thinking"
  return "try_next"
}

const exhausted = new Map<string, number>()
const TTL = Number(process.env.QWEN_EXHAUSTED_TTL_MS ?? 30 * 60_000)
export const clearExhausted = () => exhausted.clear()
const spent = (lane: string, model: string) => { const t = exhausted.get(`${lane}:${model}`); if (t === undefined) return false; if (t <= Date.now()) { exhausted.delete(`${lane}:${model}`); return false } return true }

export interface Attempt { lane: string; model: string; status: number | "timeout" | "network" | "skipped"; note: string }
export interface Completion { text: string; lane: Lane["id"]; model: string; attempts: Attempt[] }
export class QwenFailure extends Error {
  constructor(message: string, readonly attempts: Attempt[]) { super(message); this.name = "QwenFailure" }
}

const MESSAGE = (body: string) => {
  try { const j = JSON.parse(body); const m = j?.error?.message ?? j?.message ?? j?.error; return typeof m === "string" ? m : "" } catch { return /<html/i.test(body) ? "an HTML page, not an API answer" : body.replace(/\s+/g, " ").trim() }
}

/** The hybrid Qwen3.5+ models think by default; a writing draft does not need it, and thinking answers are not returned the way a draft needs. */
const hybrid = (model: string) => /^qwen3\.\d/.test(model)

export async function complete(
  lanes: Lane[],
  req: { system: string; user: string; temperature: number; maxTokens: number },
  opts: { fetchImpl?: typeof fetch; perCallMs?: number; deadlineMs?: number } = {},
): Promise<Completion> {
  const f = opts.fetchImpl ?? fetch
  const started = Date.now()
  const attempts: Attempt[] = []
  if (!lanes.length) throw new QwenFailure("No Qwen key is configured.", attempts)
  for (const lane of lanes) {
    for (const model of lane.models) {
      if (opts.deadlineMs && Date.now() - started > opts.deadlineMs) { attempts.push({ lane: lane.id, model, status: "skipped", note: "out of time" }); continue }
      if (spent(lane.id, model)) { attempts.push({ lane: lane.id, model, status: "skipped", note: "free allowance spent (remembered)" }); continue }
      let thinkingOff = hybrid(model)
      for (let pass = 0; pass < 2; pass++) {
        let res: Response
        try {
          res = await f(`${lane.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${lane.key}`, "user-agent": "Anker-SAIL/1.0 (+https://an-ker.de)" },
            body: JSON.stringify({ model, temperature: req.temperature, max_tokens: req.maxTokens, ...(thinkingOff ? { enable_thinking: false } : {}), messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] }),
            signal: AbortSignal.timeout(opts.perCallMs ?? 100_000),
          })
        } catch (e) {
          attempts.push({ lane: lane.id, model, status: (e as Error)?.name === "TimeoutError" ? "timeout" : "network", note: (e as Error)?.message?.slice(0, 120) ?? "" })
          break
        }
        const body = await res.text().catch(() => "")
        const verdict = classify(res.status, body)
        if (verdict === "retry_without_thinking" && thinkingOff && pass === 0) { thinkingOff = false; continue }
        if (verdict === "ok") {
          let text = ""
          try { text = String(JSON.parse(body)?.choices?.[0]?.message?.content ?? "").trim() } catch {}
          if (text) { attempts.push({ lane: lane.id, model, status: res.status, note: "ok" }); return { text, lane: lane.id, model, attempts } }
          attempts.push({ lane: lane.id, model, status: res.status, note: "empty answer" })
          break
        }
        attempts.push({ lane: lane.id, model, status: res.status, note: MESSAGE(body).slice(0, 160) })
        if (verdict === "model_exhausted") exhausted.set(`${lane.id}:${model}`, Date.now() + TTL)
        if (verdict === "lane_refused") break
        break
      }
      if (attempts.at(-1)?.status === 401) break // the key itself is refused: no other model in this lane will work
    }
  }
  throw new QwenFailure(describeFailure(lanes, attempts), attempts)
}

/** A sentence an editor can act on: what each lane said, and the usual cause. */
export function describeFailure(lanes: Lane[], attempts: Attempt[]): string {
  const parts = lanes.map((l) => {
    const mine = attempts.filter((a) => a.lane === l.id && a.status !== "skipped")
    const last = mine.at(-1)
    const name = l.id === "free" ? "free lane" : "plan lane"
    if (!last) return `${name}: every model was skipped`
    const why = last.status === 401 ? "the key was refused (a key only works in the region that issued it)" : last.status === "timeout" ? "timed out" : last.status === "network" ? "could not be reached" : `${last.status}${last.note ? ` ${last.note}` : ""}`
    return `${name}: ${why}`
  })
  return `Qwen could not draft this. ${parts.join("; ")}. Check the keys on the AI configuration page.`
}
