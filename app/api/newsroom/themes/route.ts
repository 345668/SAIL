import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { slugify } from "@/lib/newsroom"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const norm = (r: any) => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  description: r.description ?? null,
  keywords: Array.isArray(r.keywords) ? r.keywords : [],
  enabled: r.enabled !== false,
  position: r.position ?? null,
})

export async function GET() {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const rows = await sql`SELECT id, name, slug, description, keywords, enabled, position FROM news_themes ORDER BY position NULLS LAST, name`
    return NextResponse.json({ themes: rows.map(norm) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "load failed", themes: [] }, { status: 500 })
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
  const name = String(b.name || "").trim()
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 })
  const slug = slugify(b.slug ? String(b.slug) : name) || `theme-${Date.now().toString(36)}`
  const description = b.description ? String(b.description).trim() : null
  const keywords = Array.isArray(b.keywords)
    ? b.keywords.map((s: any) => String(s).trim()).filter(Boolean)
    : String(b.keywords || "").split(",").map((s) => s.trim()).filter(Boolean)
  try {
    const rows = await sql`
      INSERT INTO news_themes (name, slug, description, keywords)
      VALUES (${name}, ${slug}, ${description}, ${keywords as any})
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, keywords = EXCLUDED.keywords, updated_at = now()
      RETURNING id, name, slug, description, keywords, enabled, position`
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'newsroom.theme_upsert', ${slug}, NULL)`
    return NextResponse.json({ theme: norm(rows[0]) }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "save failed" }, { status: 500 })
  }
}
