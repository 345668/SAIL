import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const STATUSES = ["draft", "published", "archived"]

/** Transition status (publish stamps published_at) and/or edit light fields. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }

  try {
    if (typeof body.status === "string") {
      const status = body.status
      if (!STATUSES.includes(status)) return NextResponse.json({ error: "bad status" }, { status: 400 })
      // Publishing stamps published_at (only if not already set); un-publishing keeps history.
      const rows =
        status === "published"
          ? await sql`UPDATE news_articles
                SET status = 'published', published_at = COALESCE(published_at, NOW()), updated_at = NOW()
                WHERE id = ${id}
                RETURNING id, headline, subheadline, author, blog_type, status, image_url, slug, published_at, created_at, updated_at`
          : await sql`UPDATE news_articles
                SET status = ${status}, updated_at = NOW()
                WHERE id = ${id}
                RETURNING id, headline, subheadline, author, blog_type, status, image_url, slug, published_at, created_at, updated_at`
      if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 })
      await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
        VALUES (${staff.id}, ${staff.email}, ${"newsroom." + status}, ${id}, NULL)`
      return NextResponse.json({ article: rows[0] })
    }
    return NextResponse.json({ error: "nothing to update" }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "update failed" }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  try {
    await sql`DELETE FROM news_articles WHERE id = ${id}`
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'newsroom.delete', ${id}, NULL)`
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "delete failed" }, { status: 500 })
  }
}
