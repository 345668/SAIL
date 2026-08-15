import { sql } from "./db"

/**
 * Newsroom CMS — ported from the Anker tenant admin into the company portal.
 * Full CRUD over the shared `news_articles` table plus editorial `news_themes`.
 * Reads use SELECT * so column drift (e.g. a not-yet-migrated `sentiment`)
 * never breaks the list; writes probe for optional columns first.
 */

export const ARTICLE_STATUSES = ["draft", "published", "archived"] as const
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number]

export const ARTICLE_BLOG_TYPES = [
  "Insights", "Trends", "Analysis", "Guides",
  "News", "Press", "Investment", "Announcements",
] as const
export type ArticleBlogType = (typeof ARTICLE_BLOG_TYPES)[number]

export const ARTICLE_SENTIMENTS = ["bullish", "neutral", "bearish"] as const
export type ArticleSentiment = (typeof ARTICLE_SENTIMENTS)[number]

export interface NewsArticle {
  id: string
  slug: string | null
  headline: string
  subheadline: string | null
  content: string | null
  author: string
  blog_type: string
  tags: string[]
  status: ArticleStatus
  image_url: string | null
  scheduled_for: string | null
  source_pdf_url: string | null
  sentiment: ArticleSentiment | null
  published_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string | null
}

// ── slug helpers (mirror the tenant recipe) ─────────────────────────────────
export function slugify(input: string): string {
  if (!input) return ""
  const trimmed = input.toLowerCase().replace(/['"`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  if (trimmed.length <= 70) return trimmed
  const cut = trimmed.slice(0, 70)
  const lastHyphen = cut.lastIndexOf("-")
  return lastHyphen > 40 ? cut.slice(0, lastHyphen) : cut
}

async function slugExists(slug: string, exceptId?: string): Promise<boolean> {
  const rows = exceptId
    ? await sql`SELECT 1 FROM news_articles WHERE slug = ${slug} AND id <> ${exceptId} LIMIT 1`
    : await sql`SELECT 1 FROM news_articles WHERE slug = ${slug} LIMIT 1`
  return rows.length > 0
}

export async function ensureUniqueSlug(base: string, exceptId?: string): Promise<string> {
  const cleaned = base || "article"
  if (!(await slugExists(cleaned, exceptId))) return cleaned
  for (let i = 2; i < 50; i++) {
    const candidate = `${cleaned}-${i}`
    if (!(await slugExists(candidate, exceptId))) return candidate
  }
  return `${cleaned}-${Date.now().toString(36).slice(-6)}`
}

// ── optional-column probe (sentiment shipped after the base schema) ─────────
let _sentimentCol: Promise<boolean> | null = null
export function hasSentiment(): Promise<boolean> {
  if (_sentimentCol) return _sentimentCol
  _sentimentCol = (async () => {
    try {
      const r = await sql`
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='news_articles' AND column_name='sentiment' LIMIT 1`
      return r.length > 0
    } catch {
      return false
    }
  })()
  return _sentimentCol
}

function normalizeTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((s) => typeof s === "string") as string[]
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v)
      if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string")
    } catch {
      return v.split(",").map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

export function normalizeRow(r: any): NewsArticle {
  return {
    id: r.id,
    slug: r.slug ?? null,
    headline: r.headline ?? "(untitled)",
    subheadline: r.subheadline ?? null,
    content: r.content ?? null,
    author: r.author ?? "Anker",
    blog_type: r.blog_type ?? "Insights",
    tags: normalizeTags(r.tags),
    status: (ARTICLE_STATUSES as readonly string[]).includes(r.status) ? r.status : "draft",
    image_url: r.image_url ?? null,
    scheduled_for: r.scheduled_for ? String(r.scheduled_for) : null,
    source_pdf_url: r.source_pdf_url ?? null,
    sentiment: (ARTICLE_SENTIMENTS as readonly string[]).includes(r.sentiment) ? r.sentiment : null,
    published_at: r.published_at ? String(r.published_at) : null,
    created_by: r.created_by ?? null,
    created_at: r.created_at ? String(r.created_at) : "",
    updated_at: r.updated_at ? String(r.updated_at) : null,
  }
}
