import { createHash } from "node:crypto"
import { sql } from "@/lib/db"
import type { NewsItem } from "@/lib/news/providers"

/**
 * Persist a fetched feed into news_source_items.
 *
 * Fetching was fetch-and-forget: eight providers were queried, the results were
 * rendered, and then dropped. But the drafting endpoint grounds articles by
 * retrieving from news_source_items — so with nothing writing to it, every
 * "ground from news" draft silently fell back to ungrounded generation. This
 * is the missing half.
 *
 * Deliberately best-effort: a failed write must never lose the reader their
 * feed, which is already on screen. The route reports how many were stored and
 * carries on.
 */

/** Provider id → the news_sources row seeded by 2026-09-18-news-ingest.sql. */
const SOURCE_IDS: Record<string, string> = {
  "alpha-vantage": "prov-alpha-vantage",
  finnhub: "prov-finnhub",
  marketaux: "prov-marketaux",
  newsapi: "prov-newsapi",
  fred: "prov-fred",
  massive: "prov-massive",
  "sec-edgar": "prov-sec-edgar",
  "hacker-news": "prov-hacker-news",
}

/**
 * Stable id derived from the URL.
 *
 * The same story arrives from several providers under different provider-side
 * ids, so a provider id would store it repeatedly. Hashing the URL makes a
 * re-fetch of the same article resolve to the same row, which is also what
 * lets the unique index on source_url do its job rather than raise.
 */
function itemId(url: string): string {
  const hex = createHash("sha256").update(url).digest("hex")
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-")
}

export interface IngestResult {
  /** Rows newly written this time. */
  stored: number
  skipped: number
  failed: boolean
  /**
   * Article URL → news_source_items.id, for every item now in the table
   * (newly inserted or already present). This is what lets the picker ask for
   * a draft grounded in specific stories: the provider's own id means nothing
   * to the database.
   */
  ids: Record<string, string>
}

export async function persistFetchedItems(items: NewsItem[], region: string): Promise<IngestResult> {
  const usable = items.filter(i => i.url && i.title)
  if (!usable.length) return { stored: 0, skipped: 0, failed: false, ids: {} }

  let stored = 0
  const ids: Record<string, string> = {}
  try {
    for (const item of usable) {
      const sourceId = SOURCE_IDS[item.provider]
      // An unknown provider would violate the FK on source_id. Skip it rather
      // than inventing a news_sources row from feed data.
      if (!sourceId) continue
      // Deterministic, so a conflict still tells us where the row lives.
      ids[item.url] = itemId(item.url)
      const rows = (await sql`
        INSERT INTO news_source_items
          (id, source_id, external_id, headline, summary, source_url, published_at,
           geography, relevance_score, validation_status)
        VALUES (
          ${itemId(item.url)}, ${sourceId}, ${String(item.id).slice(0, 200)},
          ${item.title.slice(0, 500)}, ${item.summary?.slice(0, 4000) ?? null},
          ${item.url.slice(0, 1000)}, ${item.publishedAt ?? null},
          ${item.region ?? region}, ${item.sentiment ?? null}, 'pending')
        ON CONFLICT (source_url) DO NOTHING
        RETURNING id`) as Array<{ id: string }>
      if (rows.length) stored += 1
    }
  } catch (e) {
    // Shape errors (a missing migration, a renamed column) would otherwise
    // surface as a broken feed. Log and let the caller report it.
    console.error("[news ingest] persist failed", e)
    return { stored, skipped: usable.length - stored, failed: true, ids }
  }
  return { stored, skipped: usable.length - stored, failed: false, ids }
}

/** Items already stored, newest first — what the grounding picker offers. */
export interface StoredItem {
  id: string
  headline: string
  summary: string | null
  content: string | null
  source_url: string | null
  published_at: string | null
}

export interface GatherInput {
  topic: string
  themeKeywords: string[]
  sourceItemIds: string[]
  auto: boolean
}

/**
 * The stories a draft is grounded in: the editor's explicit picks, else recent
 * items matching the topic words and theme keywords.
 *
 * news_source_items.id is varchar, not uuid. The tenant app's copy of this
 * query casts the ids with ::uuid[], which throws
 * "operator does not exist: character varying = uuid" — so explicit grounding
 * has never worked there. Compared as text here.
 *
 * Recency is measured on coalesce(published_at, created_at): several providers
 * return no publication date, and judging those items to be infinitely old
 * would drop exactly the stories just fetched.
 */
export async function gatherSources(input: GatherInput): Promise<StoredItem[]> {
  try {
    if (input.sourceItemIds.length) {
      return (await sql`
        SELECT id, headline, summary, content, source_url, published_at
        FROM news_source_items WHERE id = ANY(${input.sourceItemIds})
        LIMIT 12`) as StoredItem[]
    }
    if (!input.auto) return []

    const needles = [
      ...input.topic.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 6),
      ...input.themeKeywords.map(k => k.toLowerCase()),
    ].filter(Boolean).slice(0, 12)
    if (!needles.length) return []

    // SIMILAR TO treats these as alternation metacharacters, so anything the
    // topic or a theme keyword contains has to be escaped before it becomes
    // part of the pattern.
    const pattern = "%(" + needles.map(n => n.replace(/([%_|()\[\]{}*+?\\^$.])/g, "\\$1")).join("|") + ")%"
    return (await sql`
      SELECT id, headline, summary, content, source_url, published_at
      FROM news_source_items
      WHERE coalesce(published_at, created_at) > now() - interval '45 days'
        AND (lower(headline) SIMILAR TO ${pattern} OR lower(coalesce(summary, '')) SIMILAR TO ${pattern})
      ORDER BY relevance_score DESC NULLS LAST, published_at DESC NULLS LAST
      LIMIT 8`) as StoredItem[]
  } catch (e) {
    // Grounding is an enhancement; losing it must not lose the draft.
    console.error("[news ingest] grounding retrieval failed", e)
    return []
  }
}

export async function recentStoredItems(limit = 40): Promise<StoredItem[]> {
  return (await sql`
    SELECT id, headline, summary, content, source_url, published_at
    FROM news_source_items
    ORDER BY published_at DESC NULLS LAST, created_at DESC
    LIMIT ${Math.min(100, Math.max(1, limit))}`) as StoredItem[]
}
