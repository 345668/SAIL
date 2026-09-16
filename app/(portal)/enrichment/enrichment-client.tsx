"use client"

/**
 * Ported verbatim from Anker components/admin/enrichment-panel.tsx.
 * Only change: endpoints move to the portal relay (/api/anker/...), since the
 * engine stays in the tenant app. See lib/anker-proxy.ts.
 */

import { useEffect, useState, useTransition } from "react"
import { Loader2, Sparkles, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react"

type Kind = "firm" | "investor"

interface Candidate {
  id: string
  name?: string
  first_name?: string
  last_name?: string
  website?: string
  linkedin_url?: string
  hq_location?: string
  description?: string
  bio?: string
  title?: string
}

interface RunResult {
  changes: { field: string; from: any; to: any }[]
  generatedBy: string
  durationMs: number
  crawl: { seed: string; pages: any[]; errors: any[] }
  extracted: any
}

export function EnrichmentClient() {
  const [kind, setKind] = useState<Kind>("firm")
  const [limit, setLimit] = useState(50)
  const [overwrite, setOverwrite] = useState(false)
  const [maxPages, setMaxPages] = useState(5)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, RunResult>>({})
  const [error, setError] = useState<string | null>(null)
  const [loadingList, startLoad] = useTransition()

  function loadList() {
    setError(null)
    startLoad(async () => {
      try {
        const res = await fetch(`/api/admin/enrich?kind=${kind}&limit=${limit}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`)
        setCandidates(data.candidates ?? [])
      } catch (e: any) { setError(e?.message ?? "Load failed") }
    })
  }
  useEffect(() => { loadList() }, [kind])

  async function runOne(id: string) {
    setRunning(id); setError(null)
    try {
      const body: any = { overwrite, maxPages }
      if (kind === "firm") body.firmId = id; else body.investorId = id
      const res = await fetch("/api/anker/admin/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`)
      setResults((p) => ({ ...p, [id]: data }))
    } catch (e: any) { setError(e?.message ?? "Enrichment failed") }
    finally { setRunning(null) }
  }

  return (
    <div className="space-y-6">
      <div className="border border-foreground/10 rounded-lg p-5 flex items-center gap-4 flex-wrap">
        <div>
          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Kind</label>
          <div className="mt-1.5 flex gap-1">
            {(["firm", "investor"] as Kind[]).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`px-3 py-1.5 text-xs font-mono rounded ${kind === k ? "bg-foreground text-background" : "border border-foreground/15"}`}
              >{k}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Candidates</label>
          <input
            type="number" min={1} max={500}
            value={limit}
            onChange={(e) => setLimit(+e.target.value || 50)}
            className="w-24 h-10 mt-1.5 px-3 text-sm font-mono text-right border border-foreground/15 rounded-md bg-background"
          />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Pages / row</label>
          <input
            type="number" min={1} max={10}
            value={maxPages}
            onChange={(e) => setMaxPages(+e.target.value || 5)}
            className="w-20 h-10 mt-1.5 px-3 text-sm font-mono text-right border border-foreground/15 rounded-md bg-background"
          />
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          Overwrite existing fields
        </label>
        <button
          type="button"
          onClick={loadList}
          disabled={loadingList}
          className="ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-md border border-foreground/15 text-xs hover:bg-foreground/5 disabled:opacity-50"
        >
          {loadingList ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh list
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="text-rose-700 dark:text-rose-400">{error}</span>
        </div>
      )}

      <div className="border border-foreground/10 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-foreground/5 flex items-center justify-between text-xs">
          <span className="font-mono uppercase tracking-wider text-muted-foreground">
            {candidates.length} {kind} row{candidates.length === 1 ? "" : "s"} need enrichment
          </span>
        </div>
        <div className="divide-y divide-foreground/5">
          {candidates.map((c) => {
            const r = results[c.id]
            const display = kind === "firm" ? c.name : [c.first_name, c.last_name].filter(Boolean).join(" ")
            const url = kind === "firm" ? c.website : c.linkedin_url
            return (
              <div key={c.id} className="p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{display || "(unnamed)"}</span>
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer" className="text-[11px] font-mono text-muted-foreground hover:underline truncate">
                        {url}
                      </a>
                    )}
                  </div>
                  {kind === "firm" && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {c.hq_location || "no location"} · {c.description ? "has description" : "no description"}
                    </div>
                  )}
                  {kind === "investor" && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {c.title || "no title"} · {c.bio ? "has bio" : "no bio"}
                    </div>
                  )}
                  {r && r.changes.length > 0 && (
                    <div className="mt-2 space-y-1">
                      <div className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-600">
                        <CheckCircle2 className="w-3 h-3" /> {r.changes.length} field{r.changes.length === 1 ? "" : "s"} updated · via {r.generatedBy} · {(r.durationMs / 1000).toFixed(1)}s
                      </div>
                      <ul className="text-[11px] font-mono space-y-0.5">
                        {r.changes.slice(0, 6).map((ch, i) => (
                          <li key={i} className="text-muted-foreground">
                            <span className="text-foreground">{ch.field}</span>:
                            {" "}<span className="line-through opacity-60">{stringify(ch.from)}</span>
                            {" → "}<span>{stringify(ch.to)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {r && r.changes.length === 0 && (
                    <div className="mt-2 text-[10px] font-mono text-muted-foreground italic">
                      No new info — {r.crawl.errors.length > 0 ? `crawl error: ${r.crawl.errors[0].error}` : "fields already filled or extraction empty"}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => runOne(c.id)}
                  disabled={running === c.id}
                  className="px-3 py-2 rounded-md border border-foreground/15 text-xs hover:bg-foreground/5 disabled:opacity-50 inline-flex items-center gap-2 shrink-0"
                >
                  {running === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Enrich
                </button>
              </div>
            )
          })}
          {!candidates.length && !loadingList && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No candidates need enrichment in this batch. Increase the limit, or refresh.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function stringify(v: any): string {
  if (v == null) return "—"
  if (Array.isArray(v)) return v.slice(0, 4).join(", ") + (v.length > 4 ? "…" : "")
  if (typeof v === "string") return v.length > 60 ? v.slice(0, 57) + "…" : v
  return String(v)
}
