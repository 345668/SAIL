"use client"

/**
 * Ported verbatim from Anker components/admin/crawl-panel.tsx.
 * Only change: endpoints move to the portal relay (/api/anker/...), since the
 * engine stays in the tenant app. See lib/anker-proxy.ts.
 */

import { useState, useTransition } from "react"
import { Loader2, Globe, AlertTriangle } from "lucide-react"

interface CrawlResponse {
  url: string
  finalUrl: string
  status: number
  metadata: any
  text: string
  wordCount: number
  links: { href: string; text: string; kind: string; internal: boolean }[]
  imageHeavy: boolean
  mostlyEmpty: boolean
  bytes: number
  error?: string
}

export function CrawlClient() {
  const [url, setUrl] = useState("")
  const [multi, setMulti] = useState(false)
  const [maxPages, setMaxPages] = useState(5)
  const [pending, start] = useTransition()
  const [single, setSingle] = useState<CrawlResponse | null>(null)
  const [multiResult, setMultiResult] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run() {
    if (!url.trim()) { setError("Enter a URL."); return }
    setError(null); setSingle(null); setMultiResult(null)
    start(async () => {
      try {
        const res = await fetch("/api/anker/admin/crawl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim(), multi, maxPages }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`)
        if (multi) setMultiResult(data); else setSingle(data)
      } catch (e: any) { setError(e?.message ?? "Crawl failed") }
    })
  }

  return (
    <div className="space-y-6">
      <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            className="flex-1 h-10 px-3 text-sm border border-foreground/15 rounded-md bg-background"
          />
          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
            Multi-page
          </label>
          {multi && (
            <input
              type="number" min={2} max={15}
              value={maxPages}
              onChange={(e) => setMaxPages(+e.target.value || 5)}
              className="w-20 h-10 px-2 text-sm font-mono text-right border border-foreground/15 rounded-md bg-background"
            />
          )}
          <button
            type="button"
            onClick={run}
            disabled={pending || !url.trim()}
            className="px-4 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
            Crawl
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="text-rose-700 dark:text-rose-400">{error}</span>
        </div>
      )}

      {single && (
        <div className="space-y-4">
          <SinglePage page={single} />
        </div>
      )}

      {multiResult && (
        <div className="space-y-4">
          <div className="text-xs font-mono text-muted-foreground">
            Seed: {multiResult.seed} · {multiResult.pages.length} pages · {multiResult.errors.length} errors
          </div>
          {multiResult.pages.map((p: any, i: number) => (
            <SinglePage key={i} page={p} />
          ))}
        </div>
      )}
    </div>
  )
}

function SinglePage({ page }: { page: any }) {
  const flags = []
  if (page.imageHeavy) flags.push("image-heavy")
  if (page.mostlyEmpty) flags.push("mostly empty")
  return (
    <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="font-display text-base">{page.metadata?.title || page.finalUrl || page.url}</div>
          <div className="text-[11px] font-mono text-muted-foreground">
            {page.finalUrl || page.url} · status {page.status} · {page.wordCount} words · {Math.round(page.bytes / 1024)} KB
            {flags.length > 0 && <span className="ml-2 text-amber-600">[{flags.join(", ")}]</span>}
          </div>
        </div>
      </div>
      {page.metadata?.metaDescription && (
        <p className="text-xs italic text-muted-foreground">{page.metadata.metaDescription}</p>
      )}
      {page.text && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Visible text ({page.wordCount} words)</summary>
          <pre className="mt-2 p-3 bg-foreground/[0.02] rounded text-[11px] leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto">{page.text}</pre>
        </details>
      )}
      {page.links?.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{page.links.length} links</summary>
          <ul className="mt-2 space-y-0.5 max-h-72 overflow-y-auto">
            {page.links.slice(0, 200).map((l: any, i: number) => (
              <li key={i} className="font-mono text-[11px] flex items-center gap-2">
                <span className={`text-[9px] uppercase tracking-wider px-1 rounded ${l.internal ? "bg-foreground/5" : "bg-amber-100 text-amber-700"}`}>
                  {l.kind}
                </span>
                <a href={l.href} target="_blank" rel="noreferrer" className="hover:underline truncate">{l.text || l.href}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
