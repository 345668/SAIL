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
  // AI-backed — engine needs the tenant's provider / model router / web search.
  // Provider re-probe. The only control on the tenant's AI-config page that
  // this portal could not reproduce by writing the shared DB: resolveProvider()
  // memoises per process, so after starting Ollama or rotating a key someone
  // has to tell the tenant to look again. Relayed rather than ported because
  // the thing being reset lives in the tenant's process, not in a table.
  "admin/system",
  // Status and a one-address live test for the email-verification provider
  // whose key this portal stores (docs/architecture/13 in the tenant repo).
  "admin/email-verification",
  "admin/enrich",
  "admin/deep-research",
  "admin/inbox",
  // Not AI, but relayed for the same reason: their engines are ~1,700 lines of
  // lib/admin (web-crawler, csv-importer, url-check, email-check, hunter) that
  // already read and write this same shared database. Duplicating them here
  // would mean two implementations to keep in step — the drift that has already
  // required byte-identical copies of two hash helpers and an encryption
  // scheme. The panel is identical either way, so a tool can be converted to a
  // direct port later by changing one endpoint and porting its lib.
  "admin/crawl",
  "admin/imports",
  "admin/url-check",
  "admin/url-check/fix",
  "admin/email-check",
  "admin/email-check/fix",
  "admin/email/sync-events",
  "admin/email/outbox",
  // Early-access queue. Relayed rather than ported because inviting someone
  // mints a single-use signup credential and emails it: the token has to be
  // minted by the app that will later redeem it, and only that app's database
  // can make "accepted" an observed fact. A copy here would be a second way to
  // grant access to the tenant, with its own rules to keep in step.
  "admin/waitlist",
  // Newsroom hero images. Relayed for a reason the others do not share: the
  // public newsroom is served by the tenant, and an article's image_url is a
  // tenant-relative path into its private blob store. Uploading to a store of
  // our own would produce URLs an-ker.de cannot serve, so the bytes have to
  // land where the reader will fetch them from.
  "admin/newsroom/upload-image",
  // USER-SCOPED. These authenticate as a tenant user, not as an admin, so they
  // require an explicit x-portal-act-as-user alongside the bearer. Anker
  // resolves it in lib/auth/acting-user.ts: the subject must exist, is granted
  // only that user's privileges (never admin), and every resolution is audited.
  // outreach/send-email in particular sends real email from that user.
  "outreach/send-email",
  "agents/run",
  "agents/runs",
  "agents/profile",
  "agents/tick",
] as const

/** Paths that require an acting user — refused without one. */
export const ACT_AS_REQUIRED = new Set<string>([
  "outreach/send-email",
  "agents/run",
  "agents/profile",
])

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
  /** Tenant user to act as, for the user-scoped paths. */
  actAsUser?: string | null
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
  // Fail closed: a user-scoped path with no subject would otherwise reach the
  // tenant and be rejected there as a bare 401, which reads like a broken relay
  // rather than a missing field.
  if (ACT_AS_REQUIRED.has(init.path) && !init.actAsUser) {
    return Response.json(
      { error: "This action runs as a tenant user — choose one before continuing." },
      { status: 400 },
    )
  }

  const url = `${cfg.baseUrl}/api/${init.path}${init.search ?? ""}`
  const headers: Record<string, string> = { authorization: `Bearer ${cfg.token}` }
  if (init.contentType) headers["content-type"] = init.contentType
  if (init.staffEmail) headers["x-portal-staff-email"] = init.staffEmail
  if (init.actAsUser) headers["x-portal-act-as-user"] = init.actAsUser

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
