"use client"

/**
 * Ported verbatim from Anker's components/admin/deep-research-panel.tsx —
 * same markup, classes, copy and behaviour, including the .docx download.
 *
 * The only change is the endpoint: the engine (multi-page crawl + AI synthesis)
 * stays in the tenant app, so both calls go through this portal's relay at
 * /api/anker/admin/deep-research instead of calling the tenant directly. See
 * lib/anker-proxy.ts.
 */
import { useState, useTransition } from "react"
import { Loader2, Sparkles, AlertTriangle, Download, Globe } from "lucide-react"

const API = "/api/anker/admin/deep-research"

interface ResearchResult {
  resolvedUrl: string
  dossierMarkdown: string
  pagesUsed: { url: string; title: string | null; words: number }[]
  errors: { url: string; error: string }[]
  generatedBy: string
  durationMs: number
  notes?: string
}

export function ResearchClient() {
  const [target, setTarget] = useState("")
  const [hints, setHints] = useState("")
  const [maxPages, setMaxPages] = useState(8)
  const [pending, start] = useTransition()
  const [downloading, setDownloading] = useState(false)
  const [result, setResult] = useState<ResearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run() {
    if (!target.trim()) { setError("Enter a URL or firm name."); return }
    setError(null); setResult(null)
    start(async () => {
      try {
        const res = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: target.trim(), hints: hints.trim() || undefined, maxPages }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
        setResult(data)
      } catch (e: any) { setError(e?.message ?? "Research failed") }
    })
  }

  async function downloadDocx() {
    if (!result) return
    setDownloading(true)
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), hints: hints.trim() || undefined, maxPages, format: "docx" }),
      })
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      const safe = target.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase().slice(0, 60) || "dossier"
      a.href = url; a.download = `${safe}-dossier.docx`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) { setError(e?.message ?? "Download failed") }
    finally { setDownloading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="border border-foreground/10 rounded-lg p-6 space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">URL or firm name</label>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="https://acme.vc OR Acme Ventures"
              className="w-full mt-1.5 h-10 px-3 text-sm border border-foreground/15 rounded-md bg-background"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Disambiguation hint (optional)</label>
            <input
              type="text"
              value={hints}
              onChange={(e) => setHints(e.target.value)}
              placeholder="Berlin seed-stage fintech, founded 2018"
              className="w-full mt-1.5 h-10 px-3 text-sm border border-foreground/15 rounded-md bg-background"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Max pages</label>
          <input
            type="number"
            min={2} max={15}
            value={maxPages}
            onChange={(e) => setMaxPages(+e.target.value || 8)}
            className="w-20 h-9 px-2 text-sm font-mono text-right border border-foreground/15 rounded-md bg-background"
          />
          <button
            type="button"
            onClick={run}
            disabled={pending || !target.trim()}
            className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Research
          </button>
        </div>
        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md text-xs">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span className="text-rose-700 dark:text-rose-400">{error}</span>
          </div>
        )}
      </div>

      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-xs">
              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="font-mono">{result.resolvedUrl}</span>
              <span className="text-muted-foreground">· {result.pagesUsed.length} pages used · {(result.durationMs / 1000).toFixed(1)}s · via {result.generatedBy}</span>
            </div>
            <button
              type="button"
              onClick={downloadDocx}
              disabled={downloading}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-foreground/15 text-xs hover:bg-foreground/5 disabled:opacity-50"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Word .docx
            </button>
          </div>

          <div className="border border-foreground/10 rounded-lg p-6">
            <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans">{result.dossierMarkdown}</pre>
          </div>

          {result.pagesUsed.length > 0 && (
            <div className="border border-foreground/10 rounded-lg p-4">
              <h4 className="font-display text-sm mb-2">Pages used</h4>
              <ul className="space-y-1 text-[11px] font-mono text-muted-foreground">
                {result.pagesUsed.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2">
                    <a href={p.url} target="_blank" rel="noreferrer" className="hover:text-foreground truncate">{p.title || p.url}</a>
                    <span>{p.words} words</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.errors.length > 0 && (
            <div className="border border-amber-200 dark:border-amber-900 rounded-lg p-4 bg-amber-50/50 dark:bg-amber-950/20">
              <h4 className="font-display text-sm mb-2 text-amber-800 dark:text-amber-300">Crawl errors</h4>
              <ul className="space-y-1 text-[11px] font-mono">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-amber-700 dark:text-amber-400">{e.url} — {e.error}</li>
                ))}
              </ul>
            </div>
          )}

          {result.notes && (
            <p className="text-[11px] font-mono text-muted-foreground italic">{result.notes}</p>
          )}
        </div>
      )}
    </div>
  )
}
