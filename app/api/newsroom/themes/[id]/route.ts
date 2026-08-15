import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  let b: any
  try {
    b = await req.json()
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }
  try {
    if (typeof b.name === "string") await sql`UPDATE news_themes SET name = ${b.name} WHERE id = ${id}::uuid`
    if ("description" in b) await sql`UPDATE news_themes SET description = ${b.description ?? null} WHERE id = ${id}::uuid`
    if (Array.isArray(b.keywords))
      await sql`UPDATE news_themes SET keywords = ${b.keywords.map((s: any) => String(s).trim()).filter(Boolean) as any} WHERE id = ${id}::uuid`
    if (typeof b.enabled === "boolean") await sql`UPDATE news_themes SET enabled = ${b.enabled} WHERE id = ${id}::uuid`
    await sql`UPDATE news_themes SET updated_at = now() WHERE id = ${id}::uuid`
    const rows = await sql`SELECT id, name, slug, description, keywords, enabled, position FROM news_themes WHERE id = ${id}::uuid LIMIT 1`
    if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 })
    const r = rows[0] as any
    return NextResponse.json({
      theme: { id: r.id, name: r.name, slug: r.slug, description: r.description ?? null, keywords: Array.isArray(r.keywords) ? r.keywords : [], enabled: r.enabled !== false, position: r.position ?? null },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "update failed" }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  try {
    await sql`DELETE FROM news_themes WHERE id = ${id}::uuid`
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'newsroom.theme_delete', ${id}, NULL)`
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "delete failed" }, { status: 500 })
  }
}
