import { sql, query } from "./db"

export interface Check {
  name: string
  target: string | null
  status: "ok" | "down" | "unconfigured"
  detail: string
  ms: number | null
}

async function ping(name: string, envVar: string, path = "/"): Promise<Check> {
  const base = process.env[envVar]
  if (!base) return { name, target: null, status: "unconfigured", detail: `${envVar} not set`, ms: null }
  const url = base.replace(/\/$/, "") + path
  const t0 = Date.now()
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(4000) })
    const ms = Date.now() - t0
    return {
      name,
      target: base,
      status: res.ok || res.status < 500 ? "ok" : "down",
      detail: `HTTP ${res.status}`,
      ms,
    }
  } catch (e: any) {
    return { name, target: base, status: "down", detail: e?.name === "TimeoutError" ? "timeout" : (e?.message || "unreachable"), ms: Date.now() - t0 }
  }
}

export async function dbCheck(): Promise<Check> {
  const t0 = Date.now()
  try {
    await sql`SELECT 1 AS ok`
    return { name: "Postgres (Neon)", target: "shared platform DB", status: "ok", detail: "reachable", ms: Date.now() - t0 }
  } catch (e: any) {
    return { name: "Postgres (Neon)", target: "shared platform DB", status: "down", detail: e?.message || "unreachable", ms: Date.now() - t0 }
  }
}

export async function serviceChecks(): Promise<Check[]> {
  return Promise.all([
    ping("Ollama (local models)", "OLLAMA_URL", "/api/tags"),
    ping("SearXNG (web search)", "SEARXNG_URL", "/"),
    ping("Marker (PDF extraction)", "MARKER_URL", "/"),
    ping("Tenant Venture OS", "TENANT_APP_URL", "/"),
  ])
}

const TABLES = [
  "organizations",
  "memberships",
  "investors",
  "investment_firms",
  "news_articles",
  "outreach_messages",
  "platform_api_keys",
  "company_staff",
  "company_audit_log",
]

export async function tableCounts(): Promise<{ table: string; count: number | null }[]> {
  return Promise.all(
    TABLES.map(async (table) => {
      try {
        // table names are from a fixed allow-list above — safe to interpolate.
        const rows = await query(`SELECT count(*)::int AS n FROM ${table}`)
        return { table, count: Number((rows[0] as any)?.n ?? 0) }
      } catch {
        return { table, count: null }
      }
    }),
  )
}
