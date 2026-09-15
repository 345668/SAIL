/**
 * Portal — mint / list Anker LinkedIn extension tokens (extension_tokens).
 *
 * Ported from Anker's app/api/extension/tokens/route.ts, with one structural
 * change: Anker scopes every read and write to the signed-in tenant user
 * (`where user_id = <session user>`). This portal has no tenant session, so it
 * lists ACROSS ALL USERS and mints against an explicitly supplied user id.
 *
 * That is a deliberate privilege expansion, made knowingly: a token minted here
 * acts as that tenant user across every /api/extension/* endpoint on the tenant
 * app — their CRM, LinkedIn inbox and connections. Anker itself has no such
 * surface. Keep this route behind the portal staff session, and never expose it
 * to a tenant-facing client.
 *
 * POST returns the plaintext token ONCE; only its SHA-256 hash is stored.
 */
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { mintToken, isUuid } from "@/lib/extension-tokens"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    // COALESCE mirrors Anker: the v0 schema wrote `prefix`, an earlier
    // bootstrap migration wrote `token_prefix`. Either may be populated.
    const tokens = await sql`
      SELECT id, user_id,
             COALESCE(prefix, token_prefix) AS prefix,
             label, created_at, last_used_at, revoked_at
        FROM extension_tokens
       ORDER BY created_at DESC
       LIMIT 500`
    return NextResponse.json({ tokens })
  } catch (e: any) {
    return NextResponse.json({ tokens: [], warning: e?.message || "Failed to load tokens." })
  }
}

export async function POST(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}) as any)
  const userId = String(body.userId || "").trim()
  const label = (body.label || "").toString().slice(0, 64).trim() || "Extension"

  // No default. A portal staff id is not a tenant user id, and minting against
  // the wrong subject would hand out a credential acting as someone else.
  if (!userId) {
    return NextResponse.json(
      { error: "Tenant user id is required — the user this token will act as." },
      { status: 400 },
    )
  }
  if (!isUuid(userId)) {
    return NextResponse.json({ error: "Tenant user id must be a UUID." }, { status: 400 })
  }

  const { plaintext, hash, prefix } = mintToken()
  try {
    const rows = (await sql`
      INSERT INTO extension_tokens (user_id, token_hash, prefix, label)
      VALUES (${userId}::uuid, ${hash}, ${prefix}, ${label})
      RETURNING id, created_at
    `) as Array<{ id: string; created_at: Date }>
    return NextResponse.json({
      id: rows[0].id,
      userId,
      label,
      prefix,
      createdAt: rows[0].created_at,
      token: plaintext,
      notice:
        "This is the only time this token is shown. It acts as the named tenant user on every extension endpoint — hand it over deliberately.",
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Mint failed" }, { status: 500 })
  }
}
