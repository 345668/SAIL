"use client"

/**
 * Ported from Anker components/admin/agent-panel.tsx.
 *
 * Two changes: endpoints move to the portal relay (/api/anker/...), and every
 * request carries x-portal-act-as-user, because these endpoints authenticate as
 * a TENANT USER rather than an admin. The acting user is chosen in the page
 * above and threaded through actAs. See lib/anker-proxy.ts.
 */

import { useEffect, useState, useTransition } from "react"
import { Loader2, Sparkles, AlertTriangle, Play, Search, History, RefreshCw } from "lucide-react"

type StepName = "enrich" | "profile" | "draft" | "classify_reply" | "check_followup" | "sync"
interface StepResult { step: StepName; status: "ok" | "skipped" | "error"; detail: string; durationMs: number; data?: any }
interface RunResult {
  crmEntryId: string
  mode: string
  steps: StepResult[]
  durationMs: number
  finalStage: string | null
}
interface TickResult { processed: number; results: RunResult[] }
interface HistoricRun extends RunResult {
  id: string
  displayName: string | null
  trigger: string
  error: string | null
  startedAt: string | null
}

const TONE: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  skipped: "bg-foreground/5 text-foreground/60",
  error: "bg-rose-100 text-rose-700",
}

export function AgentClient({ actAs }: { actAs: string }) {
  /**
   * Every call here runs as a TENANT USER, not as an admin, so the relay needs
   * the subject on each request. Threaded from the page's user picker.
   */
  const afetch = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), "x-portal-act-as-user": actAs },
    })

  const [crmEntryId, setCrmEntryId] = useState("")
  const [mode, setMode] = useState<"auto" | "research-only" | "draft-only">("auto")
  const [channel, setChannel] = useState<"auto" | "email" | "linkedin">("auto")
  const [tickLimit, setTickLimit] = useState(10)
  const [running, startRun] = useTransition()
  const [ticking, startTick] = useTransition()
  const [profilePending, startProfile] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<RunResult | null>(null)
  const [tickResult, setTickResult] = useState<TickResult | null>(null)
  const [profileQuery, setProfileQuery] = useState("")
  const [profile, setProfile] = useState<any | null>(null)
  const [history, setHistory] = useState<HistoricRun[] | null>(null)
  const [historyLoading, startHistory] = useTransition()

  function loadHistory() {
    startHistory(async () => {
      try {
        const res = await afetch("/api/anker/agents/runs?limit=50", { cache: "no-store" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`)
        setHistory(data.runs ?? [])
      } catch (e: any) { setError(e?.message ?? "History load failed") }
    })
  }
  useEffect(() => { loadHistory() }, [])

  function runOne() {
    if (!crmEntryId.trim()) { setError("Enter a CRM entry id."); return }
    setError(null); setRun(null)
    startRun(async () => {
      try {
        const res = await afetch("/api/anker/agents/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ crmEntryId: crmEntryId.trim(), mode, channel, force: false }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`)
        setRun(data)
        loadHistory()
      } catch (e: any) { setError(e?.message ?? "Run failed") }
    })
  }

  function runTick() {
    setError(null); setTickResult(null)
    startTick(async () => {
      try {
        const res = await afetch("/api/anker/agents/tick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "research-only", limit: tickLimit }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`)
        setTickResult(data)
        loadHistory()
      } catch (e: any) { setError(e?.message ?? "Tick failed") }
    })
  }

  function buildProfile() {
    if (!profileQuery.trim()) { setError("Enter an investor id, firm id, or LinkedIn URL."); return }
    setError(null); setProfile(null)
    startProfile(async () => {
      try {
        const q = profileQuery.trim()
        const body: any = {}
        if (q.startsWith("inv_")) body.investorId = q
        else if (q.startsWith("ifm_") || q.startsWith("fp_")) body.firmId = q
        else if (/linkedin\.com/i.test(q)) body.linkedinUrl = q
        else if (/^https?:\/\//i.test(q)) body.firmWebsite = q
        else { setError("Pass an investor id, firm id, LinkedIn URL, or firm website."); return }
        const res = await afetch("/api/anker/agents/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error ?? `Failed (${res.status})`)
        setProfile(data.profile)
      } catch (e: any) { setError(e?.message ?? "Profile build failed") }
    })
  }

  return (
    <div className="space-y-6">
      <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
        <h3 className="font-display text-base">Run agent on one CRM entry</h3>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={crmEntryId}
            onChange={(e) => setCrmEntryId(e.target.value)}
            placeholder="crm_entry_… id"
            className="flex-1 min-w-[240px] h-10 px-3 text-sm font-mono border border-foreground/15 rounded-md bg-background"
          />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as any)}
            className="h-10 px-3 text-sm border border-foreground/15 rounded-md bg-background"
          >
            <option value="auto">auto (all steps)</option>
            <option value="research-only">research only</option>
            <option value="draft-only">research + draft</option>
          </select>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as any)}
            className="h-10 px-3 text-sm border border-foreground/15 rounded-md bg-background"
            title="auto picks email if the entry has an email + RESEND_API_KEY is set; otherwise LinkedIn"
          >
            <option value="auto">channel: auto</option>
            <option value="email">channel: email</option>
            <option value="linkedin">channel: linkedin</option>
          </select>
          <button
            type="button"
            onClick={runOne}
            disabled={running}
            className="px-4 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run
          </button>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">
          The agent NEVER auto-sends. Drafts land at status='draft' and require approval in /dashboard/shortlist.
        </p>
      </div>

      <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
        <h3 className="font-display text-base">Background tick (admin)</h3>
        <div className="flex gap-2 items-center">
          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Entries</label>
          <input
            type="number"
            min={1} max={100}
            value={tickLimit}
            onChange={(e) => setTickLimit(+e.target.value || 10)}
            className="w-20 h-10 px-3 text-sm font-mono text-right border border-foreground/15 rounded-md bg-background"
          />
          <button
            type="button"
            onClick={runTick}
            disabled={ticking}
            className="ml-auto px-4 py-2 rounded-md border border-foreground/15 text-sm hover:bg-foreground/5 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {ticking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Run tick (research-only)
          </button>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">
          Pulls the oldest N entries in queued / contacted / responded and runs research only — no DM drafting (founder context isn't available here).
        </p>
      </div>

      <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
        <h3 className="font-display text-base">Build investor profile</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={profileQuery}
            onChange={(e) => setProfileQuery(e.target.value)}
            placeholder="inv_… / ifm_… / https://acme.vc / https://www.linkedin.com/in/…"
            className="flex-1 h-10 px-3 text-sm font-mono border border-foreground/15 rounded-md bg-background"
          />
          <button
            type="button"
            onClick={buildProfile}
            disabled={profilePending}
            className="px-4 py-2 rounded-md bg-foreground text-background text-sm hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {profilePending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Build
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="text-rose-700 dark:text-rose-400">{error}</span>
        </div>
      )}

      {/* ─── Run result ─── */}
      {run && <RunCard r={run} />}

      {/* ─── Tick result ─── */}
      {tickResult && (
        <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
          <h3 className="font-display text-base">Tick · processed {tickResult.processed}</h3>
          <div className="space-y-2">
            {tickResult.results.map((r, i) => <RunCard key={i} r={r} compact />)}
          </div>
        </div>
      )}

      {/* ─── Profile ─── */}
      {profile && <ProfileCard p={profile} />}

      {/* ─── Recent runs ─── */}
      <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-display text-base">Recent runs</h3>
          <span className="text-[10px] font-mono text-muted-foreground">
            {history?.length ?? 0} of last 50
          </span>
          <button
            type="button"
            onClick={loadHistory}
            disabled={historyLoading}
            className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-foreground/15 hover:bg-foreground/5 disabled:opacity-50"
          >
            {historyLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        </div>
        {(history ?? []).length === 0 && !historyLoading && (
          <div className="text-xs text-muted-foreground py-3">
            No runs yet. Trigger one above to see history populate.
          </div>
        )}
        <div className="space-y-2">
          {(history ?? []).map((r) => (
            <div key={r.id} className="border border-foreground/10 rounded p-3">
              <div className="flex items-center justify-between mb-2 text-xs">
                <div className="min-w-0 truncate">
                  <span className="font-mono">{r.crmEntryId.slice(0, 12)}…</span>
                  {r.displayName && <span className="ml-2 text-muted-foreground truncate">{r.displayName}</span>}
                </div>
                <div className="flex items-center gap-2 text-muted-foreground font-mono text-[10px] flex-shrink-0">
                  <span className="opacity-70">mode: {r.mode}</span>
                  <span className="opacity-70">via: {r.trigger}</span>
                  {r.finalStage && <span className="opacity-70">→ {r.finalStage}</span>}
                  <span>{(r.durationMs / 1000).toFixed(1)}s</span>
                  {r.startedAt && <span className="opacity-70">{new Date(r.startedAt).toLocaleTimeString()}</span>}
                </div>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {r.steps.map((s, i) => (
                  <div key={i} className={`px-1.5 py-1 rounded text-[10px] ${TONE[s.status]}`} title={s.detail}>
                    <div className="font-mono uppercase tracking-wider opacity-80 truncate">{s.step}</div>
                    <div className="opacity-70">{s.status}</div>
                  </div>
                ))}
              </div>
              {r.error && (
                <div className="mt-2 text-[10px] font-mono text-rose-700 truncate">{r.error}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function RunCard({ r, compact = false }: { r: RunResult; compact?: boolean }) {
  return (
    <div className="border border-foreground/10 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2 text-xs">
        <div>
          <span className="font-mono">{r.crmEntryId.slice(0, 14)}…</span>
          <span className="ml-2 text-muted-foreground">mode: {r.mode}</span>
          {r.finalStage && <span className="ml-2 text-muted-foreground">stage: {r.finalStage}</span>}
        </div>
        <span className="text-muted-foreground font-mono text-[10px]">{(r.durationMs / 1000).toFixed(1)}s</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        {r.steps.map((s, i) => (
          <div key={i} className={`p-2 rounded ${TONE[s.status]}`}>
            <div className="text-[9px] font-mono uppercase tracking-wider opacity-80">{s.step}</div>
            <div className="text-[10px] mt-1 leading-tight">{compact ? s.status : s.detail}</div>
            {!compact && <div className="text-[9px] font-mono mt-1 opacity-60">{s.durationMs} ms</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function ProfileCard({ p }: { p: any }) {
  return (
    <div className="border border-foreground/10 rounded-lg p-5 space-y-3">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{p.title || "—"} · {p.firm || "—"}</div>
        <h3 className="font-display text-xl mt-1">{p.fullName}</h3>
        <p className="text-sm text-muted-foreground mt-1">{p.headline}</p>
      </div>
      {p.summary && <p className="text-sm leading-relaxed">{p.summary}</p>}
      <div className="grid md:grid-cols-2 gap-3 text-xs">
        {p.sectors?.length > 0 && (
          <div><span className="font-mono uppercase tracking-wider text-muted-foreground text-[10px]">Sectors</span><div className="mt-1">{p.sectors.join(", ")}</div></div>
        )}
        {p.stages?.length > 0 && (
          <div><span className="font-mono uppercase tracking-wider text-muted-foreground text-[10px]">Stages</span><div className="mt-1">{p.stages.join(", ")}</div></div>
        )}
      </div>
      {p.attributedDeals?.length > 0 && (
        <div>
          <div className="font-mono uppercase tracking-wider text-muted-foreground text-[10px] mb-1">Deals attributed to this person</div>
          <ul className="text-xs space-y-0.5">
            {p.attributedDeals.map((d: any, i: number) => <li key={i}>{d.name}{d.year ? ` · ${d.year}` : ""}{d.role ? ` · ${d.role}` : ""}</li>)}
          </ul>
        </div>
      )}
      {p.talkingPoints?.length > 0 && (
        <div>
          <div className="font-mono uppercase tracking-wider text-muted-foreground text-[10px] mb-1">Talking points (DM hooks)</div>
          <ul className="text-xs space-y-0.5">
            {p.talkingPoints.map((t: string, i: number) => <li key={i}>• {t}</li>)}
          </ul>
        </div>
      )}
      {p.openQuestions?.length > 0 && (
        <div>
          <div className="font-mono uppercase tracking-wider text-muted-foreground text-[10px] mb-1">Open questions</div>
          <ul className="text-xs space-y-0.5">{p.openQuestions.map((t: string, i: number) => <li key={i}>· {t}</li>)}</ul>
        </div>
      )}
      {p.redFlags?.length > 0 && (
        <div>
          <div className="font-mono uppercase tracking-wider text-rose-600 text-[10px] mb-1">Red flags</div>
          <ul className="text-xs space-y-0.5 text-rose-700">{p.redFlags.map((t: string, i: number) => <li key={i}>! {t}</li>)}</ul>
        </div>
      )}
      {p.citations?.length > 0 && (
        <div className="text-[10px] font-mono text-muted-foreground">
          Citations: {p.citations.map((c: any, i: number) => (
            <a key={i} href={c.url} target="_blank" rel="noreferrer" className="hover:underline mr-2">{c.label}</a>
          ))}
        </div>
      )}
      <div className="text-[10px] font-mono text-muted-foreground">
        confidence {(p.confidence * 100).toFixed(0)}% · via {p.generatedBy}
      </div>
    </div>
  )
}
