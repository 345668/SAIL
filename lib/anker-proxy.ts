/**
 * Server-to-server proxy into the tenant app's admin API.
 *
 * Some portal tools (AI enrichment, deep research, the reply inbox) have their
 * engine in the tenant app — they need its AI provider, model router and
 * web-search stack. Rather than duplicate that here (which is exactly what
 * lib/ai-tasks.ts says the portal set out to avoid, and which would drift), the
 * portal hosts the UI and forwards the work.
 *
 * Trust model:
 *   • Browser → portal: the normal staff session. Checked before proxying.
 *   • Portal → tenant: PORTAL_SERVICE_TOKEN as a bearer. Anker's requireAdmin
 *     accepts it as a synthetic "portal-service" principal (opt-in there, and
 *     deliberately NOT owner-privileged).
 *
 * The client's own Authorization header is never forwarded — the bearer is
 * added server-side only, and the token never reaches a browser.
 */

/**
 * Tenant admin paths the portal may forward to. An allowlist, not a pattern:
 * the service token is full admin on the tenant side, so an open relay would
 * hand every admin route to anything that can reach this proxy.
 */
export const PROXY_ALLOWLIST = [
  "admin/enrich",
  "admin/deep-research",
  "admin/inbox",
] as const

export type ProxyPath = (typeof PROXY_ALLOWLIST)[number]

export function isProxyAllowed(path: string): path is ProxyPath {
  return (PROXY_ALLOWLIST as readonly string[]).includes(path)
}

export interface ProxyConfig { baseUrl: string; token: string }

/** Null when the proxy is not configured, so callers can degrade with a message. */
export function proxyConfig(): ProxyConfig | null {
  const baseUrl = (process.env.ANKER_BASE_URL || process.env.TENANT_APP_URL || "").replace(/\/+$/, "")
  const token = process.env.PORTAL_SERVICE_TOKEN || ""
  if (!baseUrl || token.length < 32) return null
  return { baseUrl, token }
}

export interface ForwardInit {
  path: string
  method: string
  search?: string
  body?: BodyInit | null
  contentType?: string | null
  /** Advisory attribution for the tenant's audit log. Not an auth factor. */
  staffEmail?: string | null
}

/**
 * Forward one request to the tenant admin API. Returns the upstream Response
 * untouched so the caller can stream/relay status, body and content type.
 */
export async function forwardToAnker(init: ForwardInit): Promise<Response> {
  const cfg = proxyConfig()
  if (!cfg) {
    return Response.json(
      {
        error:
          "Proxy not configured — set ANKER_BASE_URL (or TENANT_APP_URL) and a PORTAL_SERVICE_TOKEN of at least 32 characters, matching the tenant app.",
      },
      { status: 503 },
    )
  }
  if (!isProxyAllowed(init.path)) {
    return Response.json({ error: `Path not allowed: ${init.path}` }, { status: 403 })
  }

  const url = `${cfg.baseUrl}/api/${init.path}${init.search ?? ""}`
  const headers: Record<string, string> = { authorization: `Bearer ${cfg.token}` }
  if (init.contentType) headers["content-type"] = init.contentType
  if (init.staffEmail) headers["x-portal-staff-email"] = init.staffEmail

  try {
    return await fetch(url, {
      method: init.method,
      headers,
      body: init.body ?? undefined,
      cache: "no-store",
    })
  } catch (e: any) {
    return Response.json(
      { error: `Could not reach the tenant app at ${cfg.baseUrl}: ${e?.message ?? "network error"}` },
      { status: 502 },
    )
  }
}
