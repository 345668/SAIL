import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"
import { ThemesClient, type Theme } from "./themes-client"

export const dynamic = "force-dynamic"

async function load(): Promise<{ themes: Theme[]; error: string | null }> {
  try {
    const rows = await sql`SELECT id, name, slug, description, keywords, enabled, position FROM news_themes ORDER BY position NULLS LAST, name`
    const themes = (rows as any[]).map((r) => ({
      id: r.id, name: r.name, slug: r.slug, description: r.description ?? null,
      keywords: Array.isArray(r.keywords) ? r.keywords : [], enabled: r.enabled !== false, position: r.position ?? null,
    }))
    return { themes, error: null }
  } catch (e: any) {
    return { themes: [], error: e?.message || "load failed" }
  }
}

export default async function ThemesPage() {
  const { themes, error } = await load()
  return (
    <PageShell
      eyebrow="Data & growth · newsroom"
      title="Editorial themes"
      description="Editorial lenses that ground the AI first-draft. Each theme’s keywords steer the angle when selected in the article editor."
      action={
        <Link href="/newsroom" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-border text-sm hover:border-[var(--accent)]">
          <ArrowLeft className="w-4 h-4" /> Back to articles
        </Link>
      }
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn’t load themes: <span className="text-[var(--danger)]">{error}</span>. Confirm the <code>news_themes</code> table exists.
        </div>
      ) : (
        <ThemesClient initial={themes} />
      )}
    </PageShell>
  )
}
