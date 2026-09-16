/**
 * /api/anker/<tenant admin path> — staff-gated relay into the tenant admin API.
 *
 * Used by the portal tools whose engine lives in the tenant app (AI enrichment,
 * deep research, reply inbox). See lib/anker-proxy.ts for the trust model.
 *
 * Every request is checked against the portal staff session BEFORE anything is
 * forwarded, and the target must be on the allowlist — the service token is
 * full admin upstream, so this must never behave as an open relay.
 */
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { forwardToAnker } from "@/lib/anker-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
/**
 * Matches the longest upstream handler (admin/deep-research is maxDuration=300).
 * A shorter budget here would cut the relay off mid-crawl and surface as a
 * generic gateway timeout rather than the tool's own error.
 */
export const maxDuration = 300

async function relay(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { path } = await ctx.params
  const url = new URL(req.url)
  const method = req.method.toUpperCase()
  const hasBody = method !== "GET" && method !== "HEAD"

  const upstream = await forwardToAnker({
    path: (path ?? []).join("/"),
    method,
    search: url.search,
    body: hasBody ? await req.text() : null,
    contentType: hasBody ? (req.headers.get("content-type") ?? "application/json") : null,
    staffEmail: staff.email,
    // The only client header relayed. The staff session is already verified
    // above, so choosing a subject is the intended capability — but it is
    // forwarded explicitly rather than by passing the client's headers through,
    // so nothing else (an Authorization, say) can ride along.
    actAsUser: req.headers.get("x-portal-act-as-user"),
  })

  // Relay status and body as-is; the panels expect the tenant's own shapes.
  const contentType = upstream.headers.get("content-type") ?? "application/json"
  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: { "content-type": contentType },
  })
}

export const GET = relay
export const POST = relay
export const PATCH = relay
export const DELETE = relay
