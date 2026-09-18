"use client"

/**
 * Interactive news-sources picker — ported from the Anker tenant admin.
 * Region selector + topic chips + provider toggles + Fetch. Each result can
 * seed an AI draft (POST /api/newsroom/draft) and hand the fields to the
 * editor via sessionStorage.
 */

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  RefreshCcw, Loader2, Globe, MapPin, AlertTriangle, ExternalLink,
  Sparkles, Search, Filter, KeyRound,
} from "lucide-react"

interface ProviderStatus { id: string; label: string; available: boolean; requires?: string }
interface RegionDef { id: string; label: string; description: string; countryCodes: string[] }
interface TopicDef { id: string; label: string }
interface Props { providers: ProviderStatus[]; regions: RegionDef[]; topics: TopicDef[] }

interface NewsItem {
  id: string; title: string; url: string; summary: string | null; source: string
  publishedAt: string | null; region: string | null; topics: string[]
  sentiment: number | null; provider: string; imageUrl: string | null
  /** news_source_items row id, present once the fetch has been persisted. */
  storedId: string | null
}
interface ProviderResult { provider: string; ok: boolean; count: number; error?: string }

const primaryBtn = { background: "var(--primary)", color: "var(--primary-foreground)" } as const
const SENT_TONE = (n: number | null) =>
  n == null ? "var(--muted-foreground)" : n > 0.15 ? "var(--ok)" : n < -0.15 ? "var(--danger)" : "var(--muted-foreground)"

export function NewsSourcesClient({ providers, regions, topics }: Props) {
  const router = useRouter()
  const [region, setRegion] = useState("global")
  const [selectedTopics, setSelectedTopics] = useState<string[]>(["venture_capital", "ipo", "fundraising"])
  const [selectedProviders, setSelectedProviders] = useState<string[]>(providers.filter((p) => p.available).map((p) => p.id))
  const [items, setItems] = useState<NewsItem[]>([])
  const [providerResults, setProviderResults] = useState<ProviderResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [draftingId, setDraftingId] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [stored, setStored] = useState<number | null>(null)

  const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id])

  async function fetchNews() {
    setBusy(true); setError(null); setProviderResults([])
    try {
      const res = await fetch("/api/news/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region, topics: selectedTopics, providers: selectedProviders, limit: 60 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `Fetch failed (${res.status})`)
      setItems(data.items ?? [])
      setProviderResults(data.providerResults ?? [])
      setStored(typeof data.stored === "number" ? data.stored : null)
      // Selections refer to the previous feed; keep only what came back.
      setPicked((prev) => prev.filter((id) => (data.items ?? []).some((i: NewsItem) => i.storedId === id)))
      if (data.error || data.storeError) setError(data.error ?? data.storeError)
    } catch (e: any) { setError(e?.message ?? "Fetch failed") }
    finally { setBusy(false) }
  }

  useEffect(() => { fetchNews() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => `${it.title} ${it.summary ?? ""} ${it.source}`.toLowerCase().includes(q))
  }, [items, query])

  /**
   * Draft from one story, or from every story the editor ticked.
   *
   * The stories are passed as sourceItemIds, so the server injects their
   * reported facts and returns the provenance. Previously the item was
   * flattened into the topic string and the article recorded nothing about
   * what it was built from.
   */
  async function draft(items: NewsItem[], key: string) {
    const grounded = items.map((i) => i.storedId).filter((id): id is string => !!id)
    setDraftingId(key); setError(null)
    try {
      const lead = items[0]
      const topic = grounded.length
        ? (items.length === 1
            ? `${lead.title} — analyse this story for a VC and private-markets audience: why it matters to funds, founders and LPs.`
            : `A synthesis of ${items.length} related stories, led by "${lead.title}" — what the pattern across them means for funds, founders and LPs.`)
        // Not persisted (the store failed, or the provider is unmapped), so the
        // facts have to travel in the prompt or they are lost entirely.
        : [
            `Source: ${lead.source}`,
            lead.publishedAt ? `Published: ${new Date(lead.publishedAt).toISOString().slice(0, 10)}` : null,
            `Headline: ${lead.title}`,
            lead.summary ? `Summary: ${lead.summary}` : null,
            `URL: ${lead.url}`,
            "",
            `Write the newsroom article analysing this story for a VC / private-markets audience, citing the source inline as (${lead.source}, ${lead.publishedAt ? new Date(lead.publishedAt).getUTCFullYear() : new Date().getUTCFullYear()}).`,
          ].filter(Boolean).join("\n")

      const res = await fetch("/api/newsroom/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, blogType: "Analysis", sourceItemIds: grounded }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `Draft failed (${res.status})`)
      sessionStorage.setItem("newsroom:draft-from-source", JSON.stringify({
        headline: data.headline, subheadline: data.subheadline, content: data.content,
        suggestedTags: data.suggestedTags, sentiment: data.sentiment,
        sources: data.sources ?? [], sourceItemIds: data.usedSourceItemIds ?? [],
        sourceUrl: lead.url, sourceName: lead.source, sourceDate: lead.publishedAt,
        imageUrl: lead.imageUrl ?? null,
      }))
      router.push("/newsroom/new?from-source=1")
    } catch (e: any) { setError(e?.message ?? "Draft failed") }
    finally { setDraftingId(null) }
  }

  const pickedItems = items.filter((i) => i.storedId && picked.includes(i.storedId))

  const haveAnyAvailable = providers.some((p) => p.available)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Link href="/newsroom/api-keys" className="inline-flex items-center gap-2 h-9 px-3 text-sm rounded-md border border-border hover:border-[var(--accent)]">
          <KeyRound className="w-4 h-4" /> Provider keys
        </Link>
        <button type="button" onClick={fetchNews} disabled={busy}
          className="inline-flex items-center gap-2 h-9 px-4 text-sm rounded-md disabled:opacity-50" style={primaryBtn}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />} Fetch latest
        </button>
      </div>

      {!haveAnyAvailable && (
        <div className="rounded-md px-4 py-3 text-xs border" style={{ color: "var(--accent)", borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)", background: "var(--accent-soft)" }}>
          <AlertTriangle className="w-3 h-3 inline mr-1" />
          No key-based providers configured. SEC EDGAR and Hacker News still work without keys; add keys under Provider keys to enable the rest.
        </div>
      )}

      {/* Region */}
      <section className="card-elev border border-border rounded-xl p-4 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1"><Globe className="w-3 h-3" /> Region</div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {regions.map((r) => {
            const active = region === r.id
            return (
              <button key={r.id} type="button" onClick={() => setRegion(r.id)} title={r.description}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${active ? "border-transparent" : "border-border hover:border-[var(--accent)]"}`}
                style={active ? primaryBtn : undefined}>
                {r.id === "global" ? <Globe className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
                {r.label}
                {r.countryCodes.length > 0 && <span className="text-[10px] opacity-70">· {r.countryCodes.length}</span>}
              </button>
            )
          })}
        </div>
        <div className="text-[11px] text-muted-foreground">{regions.find((r) => r.id === region)?.description}</div>
      </section>

      {/* Topics */}
      <section className="card-elev border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1"><Filter className="w-3 h-3" /> Topics</div>
          <div className="text-[10px] font-mono text-muted-foreground">{selectedTopics.length} selected</div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {topics.map((t) => {
            const active = selectedTopics.includes(t.id)
            return (
              <button key={t.id} type="button" onClick={() => setSelectedTopics(toggle(selectedTopics, t.id))}
                className={`px-2.5 py-1 text-xs rounded border transition-colors ${active ? "bg-[var(--accent-soft)] border-[var(--accent)] text-foreground" : "border-border text-muted-foreground hover:border-[var(--accent)] hover:text-foreground"}`}>
                {t.label}
              </button>
            )
          })}
        </div>
      </section>

      {/* Providers */}
      <section className="card-elev border border-border rounded-xl p-4 space-y-3">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Providers</div>
        <div className="flex items-center gap-2 flex-wrap">
          {providers.map((p) => {
            const active = selectedProviders.includes(p.id)
            const status = providerResults.find((r) => r.provider === p.id)
            const dot = status?.ok ? "var(--ok)" : status && !status.ok ? "var(--danger)" : p.available ? "var(--muted-foreground)" : "color-mix(in oklab, var(--muted-foreground) 40%, transparent)"
            return (
              <button key={p.id} type="button" disabled={!p.available} onClick={() => setSelectedProviders(toggle(selectedProviders, p.id))}
                title={p.available ? p.label : `Set ${p.requires} to enable`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${active && p.available ? "border-transparent" : "border-border hover:border-[var(--accent)]"}`}
                style={active && p.available ? primaryBtn : undefined}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />
                {p.label}
                {status?.ok && <span className="text-[10px] opacity-70">· {status.count}</span>}
                {status?.error && <span className="text-[10px] opacity-70">· err</span>}
                {!p.available && <span className="text-[10px] opacity-70">· {p.requires}</span>}
              </button>
            )
          })}
        </div>
        {providerResults.some((r) => r.error) && (
          <div className="space-y-1 pt-2 border-t border-border">
            {providerResults.filter((r) => r.error).map((r) => (
              <div key={r.provider} className="text-[11px] font-mono" style={{ color: "var(--danger)" }}>{r.provider}: {r.error}</div>
            ))}
          </div>
        )}
      </section>

      {error && (
        <div className="px-3 py-2 text-xs font-mono rounded-md inline-flex items-center gap-2 border" style={{ color: "var(--danger)", borderColor: "color-mix(in oklab, var(--danger) 30%, transparent)", background: "color-mix(in oklab, var(--danger) 6%, transparent)" }}>
          <AlertTriangle className="w-3 h-3" /> {error}
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter results by keyword…"
            className="w-full h-9 pl-8 pr-3 text-sm border border-border rounded-md bg-card outline-none focus:border-[var(--accent)]" />
        </div>
        <span className="text-xs text-muted-foreground font-mono">{filtered.length}/{items.length}</span>
        {stored !== null && (
          <span className="font-mono text-[11px] text-muted-foreground" title="New stories saved for grounding. Ones already stored are not counted again.">
            · {stored} new stored
          </span>
        )}
      </div>

      {/* Grounding selection */}
      {pickedItems.length > 0 && (
        <div className="card-elev flex flex-wrap items-center gap-3 rounded-xl border border-border p-3 text-sm">
          <span>{pickedItems.length} {pickedItems.length === 1 ? "story" : "stories"} selected as sources.</span>
          <button type="button" onClick={() => draft(pickedItems, "selection")} disabled={draftingId !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs disabled:opacity-50" style={primaryBtn}>
            {draftingId === "selection"
              ? <><Loader2 className="h-3 w-3 animate-spin" /> Drafting…</>
              : <><Sparkles className="h-3 w-3" /> Draft from these {pickedItems.length}</>}
          </button>
          <button type="button" onClick={() => setPicked([])} className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">Clear</button>
        </div>
      )}

      {/* Results */}
      <div className="space-y-3">
        {busy && items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Fetching from providers…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {items.length === 0 ? "No stories returned. Adjust topics + providers and re-fetch." : "No results match your filter."}
          </div>
        ) : filtered.map((item) => (
          <NewsCard key={item.id} item={item} onDraft={() => draft([item], item.id)} drafting={draftingId === item.id}
            picked={!!item.storedId && picked.includes(item.storedId)}
            onPick={item.storedId ? () => setPicked(toggle(picked, item.storedId!)) : undefined} />
        ))}
      </div>
    </div>
  )
}

function NewsCard({ item, onDraft, drafting, picked, onPick }: {
  item: NewsItem; onDraft: () => void; drafting: boolean; picked: boolean; onPick?: () => void
}) {
  const ago = relativeTime(item.publishedAt)
  return (
    <article className="card-elev border border-border rounded-xl p-4 hover:shadow-[var(--shadow-pop)] transition-shadow">
      <div className="flex items-start gap-3">
        {onPick && (
          <label className="flex shrink-0 items-center pt-1" title="Use this story to ground a draft">
            <input type="checkbox" checked={picked} onChange={onPick} className="size-4 accent-[var(--accent)]" />
            <span className="sr-only">Select “{item.title}” as a source</span>
          </label>
        )}
        {item.imageUrl ? (
          <a href={item.url} target="_blank" rel="noreferrer" className="block w-24 h-24 md:w-32 md:h-24 shrink-0 rounded-md overflow-hidden border border-border bg-foreground/5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer"
              onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none" }} />
          </a>
        ) : null}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            <span className="text-foreground/70">{item.source}</span>
            {ago && <span>· {ago}</span>}
            {item.region && <span>· {item.region.toUpperCase()}</span>}
            {item.sentiment != null && <span style={{ color: SENT_TONE(item.sentiment) }}>· sentiment {item.sentiment.toFixed(2)}</span>}
            <span className="ml-auto px-1.5 py-0.5 rounded border border-border text-foreground/60">{item.provider}</span>
          </div>
          <a href={item.url} target="_blank" rel="noreferrer" className="block font-display text-base md:text-lg leading-snug hover:underline">
            {item.title}<ExternalLink className="w-3 h-3 inline ml-1 opacity-60" />
          </a>
          {item.summary && <p className="mt-2 text-sm text-muted-foreground line-clamp-2">{item.summary}</p>}
          {item.topics.length > 0 && (
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              {item.topics.slice(0, 6).map((t, i) => (
                <span key={`${t}-${i}`} className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground border border-border px-1.5 py-0.5 rounded">{t}</span>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={onDraft} disabled={drafting}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md disabled:opacity-50 shrink-0" style={primaryBtn}>
          {drafting ? <><Loader2 className="w-3 h-3 animate-spin" /> Drafting…</> : <><Sparkles className="w-3 h-3" /> Draft article</>}
        </button>
      </div>
    </article>
  )
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (isNaN(t)) return null
  const diff = Date.now() - t
  const min = 60_000, h = 3600_000, d = 86_400_000
  if (diff < h) return `${Math.max(1, Math.round(diff / min))}m ago`
  if (diff < d) return `${Math.round(diff / h)}h ago`
  if (diff < 30 * d) return `${Math.round(diff / d)}d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}
