/**
 * Portal — issue / list MCP access tokens (mcp_tokens).
 *
 * Ported from Anker's app/api/admin/mcp-tokens/route.ts. Same table, same hash,
 * same response shape; the gate changes from Anker's owner check to this
 * portal's staff session, since the whole portal is superuser-only.
 *
 * POST returns the raw bearer token ONCE — only its SHA-256 hash is stored.
 * GET lists non-secret metadata. Anker's MCP server (/api/mcp) resolves these
 * tokens to a scoped principal.
 */
import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { hashMcpToken } from "@/lib/mcp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const tokens = await sql`
      SELECT id, user_id, workspace_id, readonly, tools, label, created_at, last_used_at, revoked_at
      FROM mcp_tokens ORDER BY created_at DESC LIMIT 200`
    return NextResponse.json({ tokens })
  } catch {
    return NextResponse.json({
      tokens: [],
      warning: "mcp_tokens table not found — apply the 2026-08-22-mcp-tokens migration. Env tokens still work.",
    })
  }
}

export async function POST(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({}) as any)
  // `userId` is the tenant user the MCP tools act as. It is NOT the portal
  // staff id, so unlike Anker (where the owner is also a tenant user) there is
  // no sensible default here — require it explicitly.
  const userId = String(body.userId || "").trim()
  const workspaceId = body.workspaceId ? String(body.workspaceId).trim() : null
  const readonly = !!body.readonly
  const label = body.label ? String(body.label).slice(0, 120) : null
  const tools: string[] | null = Array.isArray(body.tools)
    ? body.tools.map(String)
    : typeof body.tools === "string" && body.tools.trim()
      ? body.tools.split(",").map((s: string) => s.trim()).filter(Boolean)
      : null
  if (!userId) {
    return NextResponse.json(
      { error: "Acts-as user id is required — the tenant user the MCP tools act as." },
      { status: 400 },
    )
  }

  const raw = randomBytes(24).toString("hex") // shown once, never stored
  try {
    const [row] = await sql`
      INSERT INTO mcp_tokens (token_hash, user_id, workspace_id, readonly, tools, label, created_by)
      VALUES (${hashMcpToken(raw)}, ${userId}, ${workspaceId}, ${readonly}, ${tools}::text[], ${label}, ${staff.email})
      RETURNING id, user_id, workspace_id, readonly, tools, label, created_at`
    return NextResponse.json({ token: raw, row })
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not create token: ${e?.message ?? "error"} — is the mcp_tokens migration applied?` },
      { status: 500 },
    )
  }
}
