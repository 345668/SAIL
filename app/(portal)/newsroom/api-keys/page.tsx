import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { PageShell } from "@/components/page-shell"
import { NewsApiKeysClient } from "./api-keys-client"

export const dynamic = "force-dynamic"

export default function NewsApiKeysPage() {
  return (
    <PageShell
      eyebrow="Data & growth · newsroom"
      title="News provider keys"
      description="Keys for the external news providers behind News sources. Stored encrypted-at-rest in the shared settings and used platform-wide."
      action={
        <Link href="/newsroom/sources" className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-border text-sm hover:border-[var(--accent)]">
          <ArrowLeft className="w-4 h-4" /> News sources
        </Link>
      }
    >
      <NewsApiKeysClient />
    </PageShell>
  )
}
