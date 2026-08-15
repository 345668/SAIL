import { PageShell } from "@/components/page-shell"
import { NewsroomEditor } from "../newsroom-editor"

export const dynamic = "force-dynamic"

export default function NewArticlePage() {
  return (
    <PageShell
      eyebrow="Data & growth · newsroom"
      title="New article"
      description="Draft a newsroom article. Save as a draft, AI-draft a first version, or publish straight to an-ker.de/newsroom."
    >
      <NewsroomEditor />
    </PageShell>
  )
}
