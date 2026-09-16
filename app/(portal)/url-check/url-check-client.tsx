"use client"

/**
 * Ported verbatim from Anker components/admin/url-check-panel.tsx.
 * Only change: endpoints move to the portal relay (/api/anker/...), since the
 * engine stays in the tenant app. See lib/anker-proxy.ts.
 */

import { useState, useTransition } from "react"
import {
  Loader2, AlertTriangle, Link2, Wrench, Sparkles, Search, Pencil,
  CheckCircle2, X, ExternalLink,
} from "lucide-react"

type Verdict =
  | "live" | "redirect" | "redirected_off"
  | "dead" | "blocked" | "rate_limited" | "server_error"
  | "timeout" | "tls_error" | "dns_error" | "unreachable" | "invalid_url"

interface CheckRow {
  url: string
  finalUrl: string | null
  status: number
  verdict: Verdict
  detail: string
  durationMs: number
  domainChanged: boolean
  owner?: { id: string; field: string }
}

const TONES: Record<Verdict, string> = {
  live:           "bg-emerald-100 text-emerald-700",
  redirect:       "bg-emerald-100 text-emerald-700",
  redirected_off: "bg-amber-100 text-amber-700",
  dead:           "bg-rose-100 text-rose-700",
  blocked:        "bg-amber-100 text-amber-700",
  rate_limited:   "bg-amber-100 text-amber-700",
  server_error:   "bg-rose-100 text-rose-700",
  timeout:        "bg-amber-100 text-amber-700",
  tls_error:      "bg-rose-100 text-rose-700",
  dns_error:      "bg-rose-100 text-rose-700",
  unreachable:    "bg-rose-100 text-rose-700",
  invalid_url:    "bg-rose-100 text-rose-700",
}

export function UrlCheckClient() {
  const [singleUrl, setSingleUrl] = useState("")
  const [bulkSource, setBulkSource] = useState<"firms" | "investors">("firms")
  const [bulkLimit, setBulkLimit] = useState(50)
  const [pending, start] = useTransition()
  const [results, setResults] = useState<CheckRow[]>([])
  const [summary, setSummary] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fixTarget, setFixTarget] = useState<{ row: CheckRow; index: number } | null>(null)

  function applyFixedRow(index: number, newUrl: string, newVerdict: Verdict) {
    setResults((prev) => prev.map((r, i) =>
      i === index ? { ...r, url: newUrl, finalUrl: newUrl, verdict: newVerdict, status: 200, detail: "fixed" } : r,
    ))
  }

  function runSingle() {
    if (!singleUrl.trim()) { setError("Enter a URL."); return }
    runPost({ url: singleUrl.trim() })
  }
  function runBulk() {
    runPost({ source: bulkSource, limit: bulkLimit })
  }
  function runPost(body: any) {
    setError(null); setResults([]); setSummary(null)
    start(async () => {
      try {
        const res = await fetch("/api/anker/admin/url-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`)
        setResults(data.results ?? [])
        setSummary(data.summary ?? null)
      } catch (e: any) { setError(e?.message ?? "Check failed") }
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
          <h3 className="font-display text-base">Single URL</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={singleUrl}
              onChange={(e) => setSingleUrl(e.target.value)}
              placeholder="https://example.com"
              className="flex-1 h-10 px-3 text-sm border border-foreground/15 rounded-md bg-background"
            />
            <button
              type="button"
              onClick={runSingle}
              disabled={pending}
              className="px-4 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Check
            </button>
          </div>
        </div>

        <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
          <h3 className="font-display text-base">Bulk from DB</h3>
          <div className="flex gap-2 items-center">
            <select
              value={bulkSource}
              onChange={(e) => setBulkSource(e.target.value as any)}
              className="h-10 px-3 text-sm border border-foreground/15 rounded-md bg-background"
            >
              <option value="firms">Firm websites</option>
              <option value="investors">Investor LinkedIn URLs</option>
            </select>
            <input
              type="number"
              value={bulkLimit}
              min={1} max={500}
              onChange={(e) => setBulkLimit(+e.target.value || 50)}
              className="w-24 h-10 px-3 text-sm font-mono text-right border border-foreground/15 rounded-md bg-background"
            />
            <button
              type="button"
              onClick={runBulk}
              disabled={pending}
              className="ml-auto px-4 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Run sweep
            </button>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground">
            Pulls oldest-updated rows first. Results don't write back to the DB — admin reviews verdicts manually.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="text-rose-700 dark:text-rose-400">{error}</span>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {Object.entries(summary).filter(([, n]) => n > 0).map(([v, n]) => (
            <div key={v} className={`px-3 py-2 rounded-md ${TONES[v as Verdict]}`}>
              <div className="text-[10px] font-mono uppercase tracking-wider opacity-80">{v.replace(/_/g, " ")}</div>
              <div className="text-xl font-display">{n}</div>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className="border border-foreground/10 rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-foreground/5">
              <tr>
                <th className="p-2 text-left font-mono uppercase tracking-wider text-muted-foreground">URL</th>
                <th className="p-2 text-left font-mono uppercase tracking-wider text-muted-foreground">Verdict</th>
                <th className="p-2 text-right font-mono uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="p-2 text-left font-mono uppercase tracking-wider text-muted-foreground">Final / detail</th>
                <th className="p-2 text-right font-mono uppercase tracking-wider text-muted-foreground">ms</th>
                <th className="p-2 text-right font-mono uppercase tracking-wider text-muted-foreground">Fix</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-t border-foreground/5 align-top">
                  <td className="p-2 font-mono">
                    <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline truncate inline-block max-w-xs">
                      {r.url}
                    </a>
                    {r.owner && (
                      <div className="text-[10px] text-muted-foreground">{r.owner.id} · {r.owner.field}</div>
                    )}
                  </td>
                  <td className="p-2">
                    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${TONES[r.verdict]}`}>
                      {r.verdict.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-right">{r.status || "—"}</td>
                  <td className="p-2">
                    {r.finalUrl && r.finalUrl !== r.url && (
                      <div className="font-mono truncate max-w-md">→ {r.finalUrl}</div>
                    )}
                    <div className="text-muted-foreground">{r.detail}</div>
                  </td>
                  <td className="p-2 font-mono text-right">{r.durationMs}</td>
                  <td className="p-2 text-right">
                    {needsFix(r.verdict) && r.owner ? (
                      <button
                        type="button"
                        onClick={() => setFixTarget({ row: r, index: i })}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border border-foreground/15 hover:bg-foreground/5"
                        title="Suggest a replacement URL"
                      >
                        <Wrench className="w-3 h-3" /> Fix
                      </button>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {fixTarget && (
        <FixDialog
          row={fixTarget.row}
          index={fixTarget.index}
          source={bulkSource}
          onClose={() => setFixTarget(null)}
          onApplied={(newUrl, newVerdict) => {
            applyFixedRow(fixTarget.index, newUrl, newVerdict)
            setFixTarget(null)
          }}
        />
      )}
    </div>
  )
}

const FIX_VERDICTS: Verdict[] = ["dead", "redirected_off", "blocked", "tls_error", "dns_error", "unreachable", "invalid_url", "timeout", "server_error"]
function needsFix(v: Verdict): boolean { return FIX_VERDICTS.includes(v) }

// ─── Fix dialog ─────────────────────────────────────────────────────────
type FixMode = "ai" | "search" | "manual"

interface FixProposal {
  proposed: string | null
  probe: { verdict: Verdict; finalUrl: string | null; status: number; detail: string } | null
  candidates?: { url: string; title: string; snippet: string }[]
  applied?: boolean
  detail?: string
  error?: string
}

function FixDialog({
  row,
  index,
  source,
  onClose,
  onApplied,
}: {
  row: CheckRow
  index: number
  source: "firms" | "investors"
  onClose: () => void
  onApplied: (newUrl: string, newVerdict: Verdict) => void
}) {
  const ownerKind: "firm" | "investor" = source === "firms" ? "firm" : "investor"
  const field = row.owner?.field === "linkedin_url" ? "linkedin_url" : "website"

  const [mode, setMode] = useState<FixMode>("search")
  const [manualUrl, setManualUrl] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<FixProposal | null>(null)

  async function run(apply = false) {
    if (!row.owner?.id) return
    setPending(true); setError(null); if (!apply) setProposal(null)
    try {
      const res = await fetch("/api/anker/admin/url-check/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ownerKind,
          ownerId: row.owner.id,
          field,
          url: mode === "manual" ? manualUrl.trim() : undefined,
          apply,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? `Failed (${res.status})`)
        if (data?.proposed) setProposal(data)
        return
      }
      setProposal(data)
      if (apply && data?.applied && data?.proposed) {
        const v = (data.probe?.verdict as Verdict) ?? "live"
        onApplied(data.probe?.finalUrl ?? data.proposed, v)
      }
    } catch (e: any) {
      setError(e?.message ?? "fix failed")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div className="relative bg-background border border-foreground/10 rounded-lg w-[640px] max-w-full max-h-[85vh] overflow-y-auto z-50" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-foreground/10 flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg">Fix URL</h3>
            <p className="text-[11px] font-mono text-muted-foreground mt-1 break-all">
              {row.owner?.id} · {field} · current: {row.url}
            </p>
            <p className="text-[10px] text-rose-600 mt-0.5">verdict: {row.verdict.replace(/_/g, " ")} · {row.detail}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Mode tabs */}
          <div className="flex gap-1">
            <ModeTab active={mode === "search"} onClick={() => setMode("search")} icon={Search} label="Web search" hint="SearXNG → top hit" />
            <ModeTab active={mode === "ai"} onClick={() => setMode("ai")} icon={Sparkles} label="Local AI" hint="qwen2.5 guess" />
            <ModeTab active={mode === "manual"} onClick={() => setMode("manual")} icon={Pencil} label="Manual" hint="paste URL" />
          </div>

          {mode === "manual" && (
            <input
              type="text"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="https://www.acme.vc"
              className="w-full h-10 px-3 text-sm font-mono border border-foreground/15 rounded-md bg-background"
            />
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => run(false)}
              disabled={pending || (mode === "manual" && !manualUrl.trim())}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-foreground/15 text-sm hover:bg-foreground/5 disabled:opacity-50"
            >
              {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
              Propose
            </button>
            {proposal?.proposed && (
              <button
                type="button"
                onClick={() => run(true)}
                disabled={pending}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50"
              >
                {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Apply to DB
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span className="text-rose-700 dark:text-rose-400">{error}</span>
            </div>
          )}

          {proposal && (
            <div className="border border-foreground/10 rounded-md p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">Proposed</span>
                {proposal.detail && <span className="text-[10px] font-mono text-muted-foreground">{proposal.detail}</span>}
              </div>
              {proposal.proposed ? (
                <div>
                  <a href={proposal.proposed} target="_blank" rel="noreferrer" className="font-mono text-foreground hover:underline break-all">
                    {proposal.proposed}
                  </a>
                  {proposal.probe && (
                    <div className="text-[10px] font-mono text-muted-foreground mt-1">
                      probe: {proposal.probe.verdict.replace(/_/g, " ")} ({proposal.probe.status})
                      {proposal.probe.finalUrl && proposal.probe.finalUrl !== proposal.proposed && (
                        <span> · final: <span className="text-foreground/80">{proposal.probe.finalUrl}</span></span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-muted-foreground italic">No suggestion produced. Try another mode.</div>
              )}
              {proposal.candidates && proposal.candidates.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground text-[11px]">{proposal.candidates.length} candidates</summary>
                  <ul className="mt-2 space-y-1">
                    {proposal.candidates.map((c, i) => (
                      <li key={i} className="text-[11px] font-mono">
                        <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline break-all">{c.url}</a>
                        <span className="text-muted-foreground"> — {c.title}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {proposal.applied && (
                <div className="text-emerald-700 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Written back to {ownerKind === "firm" ? "investment_firms" : "investors"}.{field}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ModeTab({ active, onClick, icon: Icon, label, hint }: { active: boolean; onClick: () => void; icon: any; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-2 rounded-md text-xs border ${active ? "bg-foreground text-background border-foreground" : "border-foreground/15 hover:bg-foreground/5"}`}
    >
      <div className="flex items-center justify-center gap-2 font-medium"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className={`text-[10px] mt-0.5 ${active ? "opacity-80" : "text-muted-foreground"}`}>{hint}</div>
    </button>
  )
}
