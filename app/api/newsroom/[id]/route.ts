import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import {
  ARTICLE_BLOG_TYPES, ARTICLE_SENTIMENTS, ARTICLE_STATUSES,
  ensureUniqueSlug, hasSentiment, normalizeRow, slugify,
} from "@/lib/newsroom"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await ctx.params
  try {
    const rows = await sql`SELECT * FROM news_articles WHERE id = ${id} LIMIT 1`
    if (rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json({ article: normalizeRow(rows[0]) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "load failed" }, { status: 500 })
  }
}

/**
 * Full partial update. Each field is written only when present in the body, so
 * a status-only quick action and a full editor save share one endpoint.
 * Publishing stamps published_at (once). A changed headline can regenerate the
 * slug when the client sends slug:"" .
 */
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
    const existing = await sql`SELECT status, published_at, headline FROM news_articles WHERE id = ${id} LIMIT 1`
    if (existing.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 })
    const prev = existing[0] as any

    // Resolve slug: explicit non-empty keeps it; "" regenerates from (new) headline.
    let slug: string | undefined
    if ("slug" in b) {
      if (b.slug === "" || b.slug === null) {
        const base = slugify(String(b.headline ?? prev.headline ?? ""))
        slug = await ensureUniqueSlug(base, id)
      } else if (typeof b.slug === "string") {
        slug = await ensureUniqueSlug(slugify(b.slug), id)
      }
    }

    const setStatus = typeof b.status === "string" && ARTICLE_STATUSES.includes(b.status)
    const publishing = setStatus && b.status === "published" && prev.status !== "published" && !prev.published_at
    const withSentiment = await hasSentiment()

    // Per-field conditional updates: a column is touched only when its key is
    // present in the body, so status-only quick actions and full editor saves
    // share this one endpoint without clobbering untouched fields.
    if ("headline" in b) await sql`UPDATE news_articles SET headline = ${String(b.headline)} WHERE id = ${id}`
    if ("subheadline" in b) await sql`UPDATE news_articles SET subheadline = ${b.subheadline ?? null} WHERE id = ${id}`
    if ("content" in b) await sql`UPDATE news_articles SET content = ${b.content ?? null} WHERE id = ${id}`
    if (typeof b.author === "string") await sql`UPDATE news_articles SET author = ${b.author} WHERE id = ${id}`
    if (typeof b.blog_type === "string" && ARTICLE_BLOG_TYPES.includes(b.blog_type))
      await sql`UPDATE news_articles SET blog_type = ${b.blog_type} WHERE id = ${id}`
    // tags is text[], not jsonb — the ::jsonb cast here made every tag edit
    // fail. The driver maps a JS array to a Postgres array directly.
    if (Array.isArray(b.tags))
      await sql`UPDATE news_articles SET tags = ${b.tags.filter((s: any) => typeof s === "string")} WHERE id = ${id}`
    if (Array.isArray(b.sources))
      await sql`UPDATE news_articles SET sources = ${JSON.stringify(b.sources.slice(0, 20))}::jsonb WHERE id = ${id}`
    if (Array.isArray(b.source_item_ids))
      await sql`UPDATE news_articles SET source_item_ids = ${b.source_item_ids.map(String).slice(0, 20)} WHERE id = ${id}`
    if ("image_url" in b) await sql`UPDATE news_articles SET image_url = ${b.image_url ?? null} WHERE id = ${id}`
    if ("scheduled_for" in b) await sql`UPDATE news_articles SET scheduled_for = ${b.scheduled_for ?? null} WHERE id = ${id}`
    if ("source_pdf_url" in b) await sql`UPDATE news_articles SET source_pdf_url = ${b.source_pdf_url ?? null} WHERE id = ${id}`
    if (slug !== undefined) await sql`UPDATE news_articles SET slug = ${slug} WHERE id = ${id}`
    if (withSentiment && "sentiment" in b) {
      const s = ARTICLE_SENTIMENTS.includes(b.sentiment) ? b.sentiment : null
      await sql`UPDATE news_articles SET sentiment = ${s} WHERE id = ${id}`
    }
    if (setStatus) await sql`UPDATE news_articles SET status = ${b.status} WHERE id = ${id}`
    if (publishing) await sql`UPDATE news_articles SET published_at = COALESCE(published_at, NOW()) WHERE id = ${id}`
    await sql`UPDATE news_articles SET updated_at = NOW() WHERE id = ${id}`

    const updated = await sql`SELECT * FROM news_articles WHERE id = ${id} LIMIT 1`
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'newsroom.update', ${id}, ${JSON.stringify({ status: b.status ?? null }).slice(0, 1000)}::jsonb)`
    return NextResponse.json({ article: normalizeRow(updated[0]) })
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
