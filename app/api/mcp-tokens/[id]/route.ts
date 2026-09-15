/**
 * Portal — revoke one MCP token (soft delete via revoked_at).
 *
 * Ported from Anker's app/api/admin/mcp-tokens/[id]/route.ts. Anker's MCP auth
 * lookup filters `revoked_at IS NULL`, so revocation takes effect immediately
 * for agents already holding the token.
 */
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  try {
    const rows = await sql`
      UPDATE mcp_tokens SET revoked_at = now()
      WHERE id = ${id} AND revoked_at IS NULL
      RETURNING id`
    return NextResponse.json({ ok: rows.length > 0, revoked: rows.length })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "revoke failed" }, { status: 500 })
  }
}
