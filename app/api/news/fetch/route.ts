import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import {
  PROVIDERS, providerById, dedupeAndRank, listProviders, primeNewsKeyCache,
  type ProviderId, type NewsItem, NewsProviderError,
} from "@/lib/news/providers"
import { REGIONS, TOPICS, type Region, type Topic } from "@/lib/news/regions"
import { persistFetchedItems } from "@/lib/news/ingest"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

interface ProviderResult { provider: ProviderId; ok: boolean; count: number; error?: string }

export async function POST(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await primeNewsKeyCache()

  let body: any
  try { body = await req.json() } catch { body = {} }

  const region = (REGIONS as readonly string[]).includes(body?.region) ? (body.region as Region) : "global"
  const topics: Topic[] = Array.isArray(body?.topics)
    ? body.topics.filter((t: any) => (TOPICS as readonly string[]).includes(t))
    : []
  const limit = clampInt(body?.limit, 5, 500, 60)

  const requested: ProviderId[] = Array.isArray(body?.providers) && body.providers.length
    ? body.providers.filter((id: any) => (PROVIDERS as readonly any[]).some((p) => p.id === id))
    : (PROVIDERS.map((p) => p.id) as ProviderId[])

  const statuses = listProviders()
  const enabled = requested.filter((id) => statuses.find((s) => s.id === id)?.available)

  if (enabled.length === 0) {
    return NextResponse.json({
      items: [],
      providerResults: statuses.map((s) => ({
        provider: s.id, ok: false, count: 0,
        error: s.available ? "not requested" : `disabled: ${s.requires} not set`,
      })),
      region, topics,
      error: "No providers are enabled. Add keys under Provider keys, or rely on SEC EDGAR / Hacker News which work without keys.",
    }, { status: 200 })
  }

  const results = await Promise.all(enabled.map(async (id): Promise<{ id: ProviderId; items: NewsItem[]; error?: string }> => {
    const provider = providerById(id)
    if (!provider) return { id, items: [], error: "unknown provider" }
    try {
      const items = await provider.fetch({ region, topics, limit })
      return { id, items }
    } catch (e: any) {
      const msg = e instanceof NewsProviderError ? e.message : (e?.message ?? "fetch failed")
      return { id, items: [], error: msg }
    }
  }))

  const allItems = results.flatMap((r) => r.items)
  const merged = dedupeAndRank(allItems).slice(0, limit)
  const providerResults: ProviderResult[] = results.map((r) => ({
    provider: r.id, ok: !r.error, count: r.items.length, error: r.error,
  }))

  // Keep what we fetched. Drafting grounds articles by retrieving from
  // news_source_items; without this the feed was rendered and thrown away, so
  // every "ground from news" draft quietly had nothing to ground in.
  const ingest = await persistFetchedItems(merged, region)

  return NextResponse.json({
    // storedId is the news_source_items row, which is what "draft grounded in
    // these stories" has to reference — the provider's own id means nothing to
    // the database.
    items: merged.map(i => ({ ...i, storedId: ingest.ids[i.url] ?? null })),
    totalBeforeDedupe: allItems.length, providerResults, region, topics,
    stored: ingest.stored,
    storeError: ingest.failed ? "Results are shown but could not be saved for grounding." : undefined,
  })
}

function clampInt(v: any, min: number, max: number, fallback: number) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}
