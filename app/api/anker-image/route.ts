/**
 * GET /api/anker-image?path=/api/newsroom/images/<file>
 *
 * Preview for an uploaded cover image. An article's image_url is a path into
 * the tenant app, which is what serves it on the public article, so the portal
 * cannot render it directly — it has to be resolved against the tenant origin.
 *
 * Read-only and public upstream (the tenant serves these to article readers
 * without auth), so this redirects rather than proxying bytes. What it must not
 * become is a way to reach arbitrary URLs through this deployment, so `path` is
 * matched against the two shapes the uploader produces and nothing else: no
 * absolute URLs, no traversal, no other tenant route.
 */
import { NextRequest, NextResponse } from "next/server"
import { proxyConfig } from "@/lib/anker-proxy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** /api/newsroom/images/<file> (blob) or /newsroom-images/<file> (local dev). */
const ALLOWED = /^\/(?:api\/newsroom\/images|newsroom-images)\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|avif|gif)$/

export async function GET(req: NextRequest) {
  const cfg = proxyConfig()
  if (!cfg) return NextResponse.json({ error: "Tenant base URL is not configured." }, { status: 503 })

  const path = req.nextUrl.searchParams.get("path") ?? ""
  if (!ALLOWED.test(path)) {
    return NextResponse.json({ error: "Not an uploaded newsroom image." }, { status: 400 })
  }
  return NextResponse.redirect(`${cfg.baseUrl}${path}`)
}
