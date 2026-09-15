/**
 * Portal — revoke one extension token (soft delete via revoked_at).
 *
 * Ported from Anker's app/api/extension/tokens/[id]/route.ts. Anker scopes the
 * update to the signed-in user's own tokens (`and user_id = <session user>`);
 * this portal can revoke any user's token, which is the safe half of staff
 * access — a leaked or stale credential can be killed without the owner.
 *
 * Anker's extension auth filters `revoked_at is null`, so revocation takes
 * effect on the next request from an installed extension.
 */
import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  try {
    const rows = await sql`
      UPDATE extension_tokens SET revoked_at = now()
      WHERE id = ${id}::uuid AND revoked_at IS NULL
      RETURNING id`
    return NextResponse.json({ ok: rows.length > 0, revoked: rows.length })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Revoke failed" }, { status: 500 })
  }
}
