import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import {
  ARTICLE_BLOG_TYPES, ARTICLE_SENTIMENTS, ARTICLE_STATUSES,
  ensureUniqueSlug, hasSentiment, normalizeRow, slugify,
} from "@/lib/newsroom"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const url = new URL(req.url)
  const status = url.searchParams.get("status")
  const blogType = url.searchParams.get("blog_type")
  const q = (url.searchParams.get("q") || "").trim()
  try {
    // Branch on filters with pure tagged templates (SELECT * survives drift).
    let rows: any[]
    const like = `%${q}%`
    if (q && status && blogType) {
      rows = await sql`SELECT * FROM news_articles WHERE status=${status} AND blog_type=${blogType} AND (headline ILIKE ${like} OR subheadline ILIKE ${like}) ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    } else if (q && status) {
      rows = await sql`SELECT * FROM news_articles WHERE status=${status} AND (headline ILIKE ${like} OR subheadline ILIKE ${like}) ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    } else if (q && blogType) {
      rows = await sql`SELECT * FROM news_articles WHERE blog_type=${blogType} AND (headline ILIKE ${like} OR subheadline ILIKE ${like}) ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    } else if (status && blogType) {
      rows = await sql`SELECT * FROM news_articles WHERE status=${status} AND blog_type=${blogType} ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    } else if (q) {
      rows = await sql`SELECT * FROM news_articles WHERE headline ILIKE ${like} OR subheadline ILIKE ${like} ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    } else if (status) {
      rows = await sql`SELECT * FROM news_articles WHERE status=${status} ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    } else if (blogType) {
      rows = await sql`SELECT * FROM news_articles WHERE blog_type=${blogType} ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    } else {
      rows = await sql`SELECT * FROM news_articles ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    }
    return NextResponse.json({ articles: rows.map(normalizeRow) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "load failed", articles: [] }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let b: any
  try {
    b = await req.json()
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }
  const headline = String(b.headline || "").trim()
  if (!headline) return NextResponse.json({ error: "headline is required" }, { status: 400 })

  const subheadline = b.subheadline ? String(b.subheadline).trim() : null
  const content = b.content != null ? String(b.content) : null
  const author = b.author ? String(b.author).trim() : "Anker"
  const blogType = ARTICLE_BLOG_TYPES.includes(b.blog_type) ? b.blog_type : "Insights"
  const status = ARTICLE_STATUSES.includes(b.status) ? b.status : "draft"
  const tags = Array.isArray(b.tags) ? b.tags.filter((s: any) => typeof s === "string") : []
  const imageUrl = b.image_url ? String(b.image_url) : null
  const scheduledFor = b.scheduled_for ? String(b.scheduled_for) : null
  const sourcePdfUrl = b.source_pdf_url ? String(b.source_pdf_url) : null
  const sentiment = ARTICLE_SENTIMENTS.includes(b.sentiment) ? b.sentiment : null
  const publishNow = status === "published"
  // Provenance from a grounded draft: which stories the piece was built on.
  const sources = Array.isArray(b.sources) ? b.sources.slice(0, 20) : null
  const sourceItemIds = Array.isArray(b.source_item_ids)
    ? b.source_item_ids.map(String).slice(0, 20) : []

  try {
    const slug = await ensureUniqueSlug(slugify(headline))
    const withSentiment = await hasSentiment()

    // news_articles.tags is text[], not jsonb. This passed JSON.stringify(tags)
    // with a ::jsonb cast, so every create failed with "column tags is of type
    // text[] but expression is of type jsonb" — the portal could not file an
    // article at all. The driver maps a JS array to a Postgres array directly.
    const rows = withSentiment
      ? await sql`
          INSERT INTO news_articles (headline, subheadline, content, author, blog_type, tags, status, image_url, slug, scheduled_for, source_pdf_url, sentiment, published_at, created_by, sources, source_item_ids)
          VALUES (${headline}, ${subheadline}, ${content}, ${author}, ${blogType}, ${tags}, ${status}, ${imageUrl}, ${slug}, ${scheduledFor}, ${sourcePdfUrl}, ${sentiment}, ${publishNow ? new Date().toISOString() : null}, ${staff.email}, ${sources ? JSON.stringify(sources) : null}::jsonb, ${sourceItemIds})
          RETURNING *`
      : await sql`
          INSERT INTO news_articles (headline, subheadline, content, author, blog_type, tags, status, image_url, slug, scheduled_for, source_pdf_url, published_at, created_by, sources, source_item_ids)
          VALUES (${headline}, ${subheadline}, ${content}, ${author}, ${blogType}, ${tags}, ${status}, ${imageUrl}, ${slug}, ${scheduledFor}, ${sourcePdfUrl}, ${publishNow ? new Date().toISOString() : null}, ${staff.email}, ${sources ? JSON.stringify(sources) : null}::jsonb, ${sourceItemIds})
          RETURNING *`

    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'newsroom.create', ${(rows[0] as any).id}, ${JSON.stringify({ headline, status })}::jsonb)`
    return NextResponse.json({ article: normalizeRow(rows[0]) }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "create failed" }, { status: 500 })
  }
}
