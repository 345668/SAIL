import { PageShell } from "@/components/page-shell"
import { listProviders, primeNewsKeyCache } from "@/lib/news/providers"
import { REGIONS, REGION_META, TOPICS, TOPIC_LABEL } from "@/lib/news/regions"
import { NewsSourcesClient } from "./sources-client"

export const dynamic = "force-dynamic"

export default async function NewsSourcesPage() {
  // Prime the runtime-keys cache BEFORE listProviders() reads availability —
  // otherwise DB-stored keys read as missing on a cold serverless invocation.
  await primeNewsKeyCache()

  return (
    <PageShell
      eyebrow="Data & growth · newsroom"
      title="News sources"
      description="Pull real-time stories from the configured providers, filter by region + topic, then seed an AI draft from any headline — grounded in the source."
    >
      <NewsSourcesClient
        providers={listProviders()}
        regions={REGIONS.map((id) => ({ id, ...REGION_META[id] }))}
        topics={TOPICS.map((id) => ({ id, label: TOPIC_LABEL[id] }))}
      />
    </PageShell>
  )
}
