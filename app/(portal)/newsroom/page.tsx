import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"
import { NewsroomClient, type Article } from "./newsroom-client"

export const dynamic = "force-dynamic"

async function loadArticles(): Promise<{ articles: Article[]; error: string | null }> {
  try {
    const rows = await sql`
      SELECT id, headline, subheadline, author, blog_type, status, image_url, slug, published_at, created_at, updated_at
      FROM news_articles ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    return { articles: rows as any[], error: null }
  } catch (e: any) {
    return { articles: [], error: e?.message || "load failed" }
  }
}

export default async function NewsroomPage() {
  const { articles, error } = await loadArticles()
  return (
    <PageShell
      eyebrow="Data & growth"
      title="Newsroom CMS"
      description="Author and publish the platform’s own public newsroom at an-ker.de/newsroom. This is the company’s marketing surface — not tenant content. Drafts stay private until you publish."
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn’t load articles: <span className="text-[var(--danger)]">{error}</span>. Confirm the shared{" "}
          <code>news_articles</code> table exists.
        </div>
      ) : (
        <NewsroomClient initial={articles} />
      )}
    </PageShell>
  )
}
