"use client"

/**
 * Ported verbatim from Anker components/admin/email-check-panel.tsx.
 * Only change: endpoints move to the portal relay (/api/anker/...), since the
 * engine stays in the tenant app. See lib/anker-proxy.ts.
 */

import { useState, useTransition } from "react"
import {
  Loader2, AlertTriangle, Mail, Wrench, Sparkles, Search, Pencil,
  CheckCircle2, X, ExternalLink, Database,
} from "lucide-react"

type Verdict =
  | "valid" | "accept_all" | "risky"
  | "webmail" | "disposable" | "invalid"
  | "no_mx" | "malformed"
  | "timeout" | "unknown" | "error"

interface CheckRow {
  email: string
  verdict: Verdict
  score: number
  detail: string
  durationMs: number
  source: "hunter" | "local"
  flags?: any
  owner?: { id: string; field: string; firmId?: string | null }
}

const TONE: Record<Verdict, string> = {
  valid:       "bg-emerald-100 text-emerald-700",
  accept_all:  "bg-amber-100 text-amber-700",
  risky:       "bg-amber-100 text-amber-700",
  webmail:     "bg-amber-100 text-amber-700",
  disposable:  "bg-rose-100 text-rose-700",
  invalid:     "bg-rose-100 text-rose-700",
  no_mx:       "bg-rose-100 text-rose-700",
  malformed:   "bg-rose-100 text-rose-700",
  timeout:     "bg-amber-100 text-amber-700",
  unknown:     "bg-foreground/5 text-foreground/60",
  error:       "bg-rose-100 text-rose-700",
}

const FIX_VERDICTS: Verdict[] = [
  "invalid", "no_mx", "malformed", "disposable", "webmail",
  "risky", "accept_all", "timeout", "unknown", "error",
]
function needsFix(v: Verdict): boolean { return FIX_VERDICTS.includes(v) }

export function EmailCheckClient() {
  const [singleEmail, setSingleEmail] = useState("")
  const [bulkLimit, setBulkLimit] = useState(50)
  const [pending, start] = useTransition()
  const [results, setResults] = useState<CheckRow[]>([])
  const [summary, setSummary] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hunterAvailable, setHunterAvailable] = useState<boolean | null>(null)
  const [fixTarget, setFixTarget] = useState<{ row: CheckRow; index: number } | null>(null)

  function applyFixedRow(index: number, newEmail: string, newVerdict: Verdict) {
    setResults((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, email: newEmail, verdict: newVerdict, score: 100, detail: "fixed" } : r,
      ),
    )
  }

  function runSingle() {
    if (!singleEmail.trim()) { setError("Enter an email."); return }
    runPost({ email: singleEmail.trim() })
  }
  function runBulk() {
    runPost({ source: "investors", limit: bulkLimit })
  }
  function runPost(body: any) {
    setError(null); setResults([]); setSummary(null)
    start(async () => {
      try {
        const res = await fetch("/api/anker/admin/email-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`)
        setResults(data.results ?? [])
        setSummary(data.summary ?? null)
        setHunterAvailable(!!data.hunterAvailable)
      } catch (e: any) { setError(e?.message ?? "Check failed") }
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
          <h3 className="font-display text-base">Single email</h3>
          <div className="flex gap-2">
            <input
              type="email"
              value={singleEmail}
              onChange={(e) => setSingleEmail(e.target.value)}
              placeholder="partner@acme.vc"
              className="flex-1 h-10 px-3 text-sm font-mono border border-foreground/15 rounded-md bg-background"
            />
            <button
              type="button"
              onClick={runSingle}
              disabled={pending}
              className="px-4 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Check
            </button>
          </div>
        </div>

        <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
          <h3 className="font-display text-base">Bulk: investors with email on file</h3>
          <div className="flex gap-2 items-center">
            <Database className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">oldest-updated first</span>
            <input
              type="number"
              value={bulkLimit}
              min={1} max={1000}
              onChange={(e) => setBulkLimit(+e.target.value || 50)}
              className="w-24 h-10 px-3 text-sm font-mono text-right border border-foreground/15 rounded-md bg-background"
            />
            <button
              type="button"
              onClick={runBulk}
              disabled={pending}
              className="ml-auto px-4 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Run sweep
            </button>
          </div>
          <p className="text-[10px] font-mono text-muted-foreground">
            Verdicts don&apos;t auto-write to the DB; use the Fix button on any row to repair.
          </p>
        </div>
      </div>

      {hunterAvailable === false && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md text-xs">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-amber-700 dark:text-amber-400">
            HUNTER_API_KEY not set — falling back to format + DNS-MX checks.  Set the key in <span className="font-mono">.env.local</span> and restart Anker for SMTP-grade verification + email-finder mode.
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="text-rose-700 dark:text-rose-400">{error}</span>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {Object.entries(summary).filter(([, n]) => (n as number) > 0).map(([v, n]) => (
            <div key={v} className={`px-3 py-2 rounded-md ${TONE[v as Verdict]}`}>
              <div className="text-[10px] font-mono uppercase tracking-wider opacity-80">{v.replace(/_/g, " ")}</div>
              <div className="text-xl font-display">{n as number}</div>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className="border border-foreground/10 rounded-lg overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-foreground/5">
              <tr>
                <th className="p-2 text-left font-mono uppercase tracking-wider text-muted-foreground">Email</th>
                <th className="p-2 text-left font-mono uppercase tracking-wider text-muted-foreground">Verdict</th>
                <th className="p-2 text-right font-mono uppercase tracking-wider text-muted-foreground">Score</th>
                <th className="p-2 text-left font-mono uppercase tracking-wider text-muted-foreground">Detail</th>
                <th className="p-2 text-right font-mono uppercase tracking-wider text-muted-foreground">ms</th>
                <th className="p-2 text-right font-mono uppercase tracking-wider text-muted-foreground">Fix</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-t border-foreground/5 align-top">
                  <td className="p-2 font-mono">
                    <span className="truncate inline-block max-w-xs">{r.email}</span>
                    {r.owner && (
                      <div className="text-[10px] text-muted-foreground">{r.owner.id} · {r.owner.field}</div>
                    )}
                  </td>
                  <td className="p-2">
                    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${TONE[r.verdict]}`}>
                      {r.verdict.replace(/_/g, " ")}
                    </span>
                    <div className="text-[10px] font-mono text-muted-foreground mt-0.5">{r.source}</div>
                  </td>
                  <td className="p-2 font-mono text-right">{r.score}</td>
                  <td className="p-2 text-muted-foreground">{r.detail}</td>
                  <td className="p-2 font-mono text-right">{r.durationMs}</td>
                  <td className="p-2 text-right">
                    {needsFix(r.verdict) && r.owner ? (
                      <button
                        type="button"
                        onClick={() => setFixTarget({ row: r, index: i })}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono rounded border border-foreground/15 hover:bg-foreground/5"
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
          hunterAvailable={!!hunterAvailable}
          onClose={() => setFixTarget(null)}
          onApplied={(newEmail, verdict) => {
            applyFixedRow(fixTarget.index, newEmail, verdict)
            setFixTarget(null)
          }}
        />
      )}
    </div>
  )
}

// ─── Fix dialog ─────────────────────────────────────────────────────────
type FixMode = "hunter" | "ai" | "manual"

function FixDialog({
  row,
  hunterAvailable,
  onClose,
  onApplied,
}: {
  row: CheckRow
  hunterAvailable: boolean
  onClose: () => void
  onApplied: (newEmail: string, verdict: Verdict) => void
}) {
  const [mode, setMode] = useState<FixMode>(hunterAvailable ? "hunter" : "ai")
  const [manualEmail, setManualEmail] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<any | null>(null)

  async function run(apply = false) {
    if (!row.owner?.id) return
    setPending(true); setError(null); if (!apply) setProposal(null)
    try {
      const res = await fetch("/api/anker/admin/email-check/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          ownerId: row.owner.id,
          field: row.owner.field,
          email: mode === "manual" ? manualEmail.trim() : undefined,
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
        const v = (data.probe?.verdict as Verdict) ?? "valid"
        onApplied(data.proposed, v)
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
            <h3 className="font-display text-lg">Fix email</h3>
            <p className="text-[11px] font-mono text-muted-foreground mt-1 break-all">
              {row.owner?.id} · current: {row.email}
            </p>
            <p className="text-[10px] text-rose-600 mt-0.5">verdict: {row.verdict.replace(/_/g, " ")} · {row.detail}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-1">
            <ModeTab
              active={mode === "hunter"}
              disabled={!hunterAvailable}
              onClick={() => setMode("hunter")}
              icon={Search}
              label="Hunter.io"
              hint={hunterAvailable ? "email-finder" : "API key missing"}
            />
            <ModeTab active={mode === "ai"} onClick={() => setMode("ai")} icon={Sparkles} label="Local AI" hint="qwen2.5 guess" />
            <ModeTab active={mode === "manual"} onClick={() => setMode("manual")} icon={Pencil} label="Manual" hint="paste email" />
          </div>

          {mode === "manual" && (
            <input
              type="email"
              value={manualEmail}
              onChange={(e) => setManualEmail(e.target.value)}
              placeholder="partner@acme.vc"
              className="w-full h-10 px-3 text-sm font-mono border border-foreground/15 rounded-md bg-background"
            />
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => run(false)}
              disabled={pending || (mode === "manual" && !manualEmail.trim())}
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
                  <div className="font-mono text-foreground break-all">{proposal.proposed}</div>
                  {proposal.probe && (
                    <div className="text-[10px] font-mono text-muted-foreground mt-1">
                      probe: {String(proposal.probe.verdict).replace(/_/g, " ")} · score {proposal.probe.score} · {proposal.probe.source}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-muted-foreground italic">No suggestion.  Try another mode.</div>
              )}
              {Array.isArray(proposal.candidates) && proposal.candidates[0]?.sources?.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground text-[11px]">
                    Hunter sources ({proposal.candidates[0].sources.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {proposal.candidates[0].sources.map((s: any, i: number) => (
                      <li key={i} className="text-[11px] font-mono">
                        <a href={s.uri} target="_blank" rel="noreferrer" className="hover:underline break-all inline-flex items-center gap-1">
                          {s.uri} <ExternalLink className="w-3 h-3" />
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {proposal.applied && (
                <div className="text-emerald-700 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Written back to investors.email
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ModeTab({
  active, disabled, onClick, icon: Icon, label, hint,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: any
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 px-3 py-2 rounded-md text-xs border ${
        active ? "bg-foreground text-background border-foreground"
        : disabled ? "border-foreground/10 opacity-50 cursor-not-allowed"
        : "border-foreground/15 hover:bg-foreground/5"
      }`}
    >
      <div className="flex items-center justify-center gap-2 font-medium"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className={`text-[10px] mt-0.5 ${active ? "opacity-80" : "text-muted-foreground"}`}>{hint}</div>
    </button>
  )
}
