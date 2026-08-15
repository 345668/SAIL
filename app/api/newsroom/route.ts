import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const BLOG_TYPES = ["Insights", "Trends", "Analysis", "Guides", "News", "Press", "Investment", "Announcements"]

function slugify(headline: string, id: string): string {
  const base = headline
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70)
    .replace(/-+$/g, "")
  return `${base || "article"}-${id.slice(0, 6)}`
}

export async function GET() {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const rows = await sql`
      SELECT id, headline, subheadline, author, blog_type, status, image_url, slug, published_at, created_at, updated_at
      FROM news_articles ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    return NextResponse.json({ articles: rows })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "load failed", articles: [] }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let headline = "", subheadline: string | null = null, content: string | null = null
  let author = "Anker", blogType = "Insights"
  try {
    const b = await req.json()
    headline = String(b.headline || "").trim()
    subheadline = b.subheadline ? String(b.subheadline).trim() : null
    content = b.content ? String(b.content) : null
    if (b.author) author = String(b.author).trim()
    if (b.blog_type && BLOG_TYPES.includes(b.blog_type)) blogType = b.blog_type
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }
  if (!headline) return NextResponse.json({ error: "headline is required" }, { status: 400 })

  try {
    // Insert first to get the generated id, then set a deterministic slug.
    const inserted = await sql`
      INSERT INTO news_articles (headline, subheadline, content, author, blog_type, status, created_by)
      VALUES (${headline}, ${subheadline}, ${content}, ${author}, ${blogType}, 'draft', ${staff.email})
      RETURNING id`
    const id = (inserted[0] as any).id as string
    const rows = await sql`
      UPDATE news_articles SET slug = ${slugify(headline, id)}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, headline, subheadline, author, blog_type, status, image_url, slug, published_at, created_at, updated_at`
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'newsroom.create', ${id}, ${JSON.stringify({ headline })}::jsonb)`
    return NextResponse.json({ article: rows[0] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "create failed" }, { status: 500 })
  }
}
