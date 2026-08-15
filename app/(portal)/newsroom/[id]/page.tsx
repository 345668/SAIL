import { notFound } from "next/navigation"
import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"
import { normalizeRow, type NewsArticle } from "@/lib/newsroom"
import { NewsroomEditor } from "../newsroom-editor"

export const dynamic = "force-dynamic"

async function load(id: string): Promise<NewsArticle | null> {
  try {
    const rows = await sql`SELECT * FROM news_articles WHERE id = ${id} LIMIT 1`
    return rows.length ? normalizeRow(rows[0]) : null
  } catch {
    return null
  }
}

export default async function EditArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const article = await load(id)
  if (!article) notFound()
  return (
    <PageShell
      eyebrow="Data & growth · newsroom"
      title="Edit article"
      description="Edit content and metadata, change status, or delete. AI drafts replace the body in place — nothing saves until you press Save."
    >
      <NewsroomEditor article={article} />
    </PageShell>
  )
}
