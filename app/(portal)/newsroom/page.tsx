import Link from "next/link"
import { Plus, Sparkles, Rss } from "lucide-react"
import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"
import { normalizeRow, type NewsArticle } from "@/lib/newsroom"
import { NewsroomClient } from "./newsroom-client"

export const dynamic = "force-dynamic"

async function loadArticles(): Promise<{ articles: NewsArticle[]; error: string | null }> {
  try {
    const rows = await sql`SELECT * FROM news_articles ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 500`
    return { articles: (rows as any[]).map(normalizeRow), error: null }
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
      description="Author and publish the platform’s own public newsroom at an-ker.de/newsroom — the company’s marketing surface, not tenant content. AI first-drafts run on the portal’s own Anthropic key; drafts stay private until you publish."
      action={
        <div className="flex items-center gap-2">
          <Link
            href="/newsroom/sources"
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md border border-border text-sm hover:border-[var(--accent)]"
          >
            <Rss className="w-4 h-4" /> Sources
          </Link>
          <Link
            href="/newsroom/themes"
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md border border-border text-sm hover:border-[var(--accent)]"
          >
            <Sparkles className="w-4 h-4" /> Themes
          </Link>
          <Link
            href="/newsroom/new"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            <Plus className="w-4 h-4" /> New article
          </Link>
        </div>
      }
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn’t load articles: <span className="text-[var(--danger)]">{error}</span>. Confirm the shared{" "}
          <code>news_articles</code> table exists (the portal migration creates it).
        </div>
      ) : (
        <NewsroomClient initial={articles} />
      )}
    </PageShell>
  )
}
