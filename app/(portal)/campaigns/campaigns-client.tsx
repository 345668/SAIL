"use client"

/**
 * Console for the founder campaign engine. The engine, its rules and its state live in the
 * tenant app; every read and every action goes through /api/anker/campaign*, so this file
 * holds no engine logic — it renders what the tenant reports and asks it to act.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { attachDeckFile } from "@/lib/deck-attach-client"
import {
  Loader2, AlertTriangle, RotateCw, Rocket, Pause, Play, CheckCircle2, Sliders, ChevronDown, ChevronRight, Check, Paperclip,
} from "lucide-react"

interface Counts { total: number; contacted: number; opened: number; interested: number; notInterested: number }
interface Row {
  id: string; publicRef: string; startupName: string; founderName: string; founderEmail: string
  status: string; assessmentScore: number | null; stage: string | null; sectors: string[]; campaignId: string | null
  counts: Counts; createdAt: string | null
}
interface Settings { readinessThreshold: number; scoreFloor: number; maxInvestors: number; waveSize: number; autoAssess: boolean; autoSend: boolean }
interface Entry {
  id: string; investorName: string | null; investorEmail: string | null; matchScore: number | null; rationale: string | null
  stage: string; contactedAt: string | null; openedAt: string | null; interestChoice: string | null; sendError: string | null
}
interface Detail {
  campaign: {
    id: string; publicRef: string; status: string; campaignStatus: string | null; sendApproved: boolean; hasDeck: boolean
    assessment: { score: number; verdict: string; summary?: string; strengths?: string[]; gaps?: string[] } | null
    declineReason: string | null; oneLiner: string | null; website: string | null; location: string | null; founderLinkedin: string | null
  }
  entries: Entry[]
}

const STATUSES = ["received", "assessing", "assessed", "campaign_ready", "outreaching", "completed", "declined", "failed"] as const
const TONES: Record<string, string> = {
  received: "bg-slate-100 text-slate-700",
  assessing: "bg-sky-100 text-sky-700",
  assessed: "bg-sky-100 text-sky-700",
  campaign_ready: "bg-violet-100 text-violet-700",
  outreaching: "bg-emerald-100 text-emerald-700",
  completed: "bg-emerald-100 text-emerald-800",
  declined: "bg-amber-100 text-amber-700",
  failed: "bg-rose-100 text-rose-700",
}
const label = (s: string) => s.replace(/_/g, " ")
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB") : "")

async function call<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/anker/${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`)
  return body as T
}

export function CampaignsClient() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const q = filter ? `?status=${encodeURIComponent(filter)}` : ""
      setRows((await call<{ campaigns: Row[] }>(`campaign${q}`)).campaigns)
      setError(null)
    } catch (e: any) { setError(e.message) }
  }, [filter])
  useEffect(() => { load() }, [load])

  // The pipeline moves on its own (cron), so keep the board current while the page is open.
  useEffect(() => {
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const totals = useMemo(() => {
    const r = rows ?? []
    return {
      applications: r.length,
      live: r.filter((x) => x.status === "outreaching" || x.status === "campaign_ready").length,
      contacted: r.reduce((n, x) => n + x.counts.contacted, 0),
      interested: r.reduce((n, x) => n + x.counts.interested, 0),
    }
  }, [rows])

  return (
    <div className="space-y-5">
      <EngineControls />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Applications" value={totals.applications} />
        <Tile label="Live campaigns" value={totals.live} />
        <Tile label="Investors contacted" value={totals.contacted} />
        <Tile label="Interested" value={totals.interested} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Pill active={filter === null} onClick={() => setFilter(null)}>All</Pill>
        {STATUSES.map((s) => <Pill key={s} active={filter === s} onClick={() => setFilter(s)}>{label(s)}</Pill>)}
        <button onClick={load} className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted" aria-label="Refresh">
          <RotateCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {!rows && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      {rows?.length === 0 && <div className="rounded-lg border border-border p-8 text-center text-sm text-muted-foreground">No applications{filter ? ` with status “${label(filter)}”` : ""} yet.</div>}

      <div className="space-y-3">
        {rows?.map((c) => (
          <div key={c.id} className="card-elev rounded-xl border border-border bg-card">
            <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full items-start gap-3 p-4 text-left">
              {open === c.id ? <ChevronDown className="mt-1 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-1 h-4 w-4 shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.startupName}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONES[c.status] ?? "bg-slate-100 text-slate-700"}`}>{label(c.status)}</span>
                  {c.assessmentScore != null && <span className="font-mono text-xs text-muted-foreground">score {c.assessmentScore}</span>}
                  <span className="font-mono text-[11px] text-muted-foreground">{c.publicRef}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {c.founderName} · {c.founderEmail}{c.stage ? ` · ${c.stage}` : ""}{c.sectors.length ? ` · ${c.sectors.slice(0, 3).join(", ")}` : ""} · {date(c.createdAt)}
                </div>
                {c.counts.total > 0 && <Funnel counts={c.counts} />}
              </div>
            </button>
            {open === c.id && <DetailPanel id={c.id} status={c.status} onChanged={load} />}
          </div>
        ))}
      </div>
    </div>
  )
}

function Funnel({ counts }: { counts: Counts }) {
  const pct = (n: number) => (counts.total ? Math.min(100, Math.round((n / counts.total) * 100)) : 0)
  return (
    <div className="mt-2.5">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${counts.contacted} of ${counts.total} contacted, ${counts.interested} interested`}>
        <div className="absolute inset-y-0 left-0 bg-sky-200" style={{ width: `${pct(counts.contacted)}%` }} />
        <div className="absolute inset-y-0 left-0 bg-sky-400" style={{ width: `${pct(counts.opened)}%` }} />
        <div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: `${pct(counts.interested)}%` }} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        <span>{counts.total} matched</span><span>{counts.contacted} contacted ({pct(counts.contacted)}%)</span>
        <span>{counts.opened} opened</span><span className="text-emerald-700">{counts.interested} interested</span><span>{counts.notInterested} passed</span>
      </div>
    </div>
  )
}

function EngineControls() {
  const [s, setS] = useState<Settings | null>(null)
  const [open, setOpen] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { call<{ settings: Settings }>("campaign/settings").then((r) => setS(r.settings)).catch((e) => setError(e.message)) }, [])

  async function save() {
    if (!s) return
    setSaving(true); setError(null)
    try {
      setS((await call<{ settings: Settings }>("campaign/settings", { method: "PUT", body: JSON.stringify(s) })).settings)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e: any) { setError(e.message) } finally { setSaving(false) }
  }

  const num = (k: keyof Settings, name: string, hint: string, min: number, max: number) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{name}</span>
      <input type="number" min={min} max={max} value={s ? (s[k] as number) : ""} onChange={(e) => s && setS({ ...s, [k]: Number(e.target.value) })}
        className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-[var(--accent)]" />
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </label>
  )
  const toggle = (k: "autoAssess" | "autoSend", name: string, hint: string) => (
    <button type="button" onClick={() => s && setS({ ...s, [k]: !s[k] })} role="switch" aria-checked={!!s?.[k]}
      className="flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted/50">
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${s?.[k] ? "bg-emerald-500" : "bg-slate-300"}`}>
        <span className={`h-4 w-4 rounded-full bg-white transition ${s?.[k] ? "translate-x-4" : ""}`} />
      </span>
      <span><span className="block text-xs font-medium">{name}: {s?.[k] ? "ON" : "OFF"}</span><span className="block text-[11px] text-muted-foreground">{hint}</span></span>
    </button>
  )

  return (
    <div className="card-elev rounded-xl border border-border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-medium">
        <Sliders className="h-4 w-4 text-muted-foreground" /> Engine controls
        {s && <span className="text-xs font-normal text-muted-foreground">· cutoff {s.readinessThreshold} · {s.autoSend ? "auto-send on" : "manual release"} · {s.autoAssess ? "auto-assess on" : "manual assess"}</span>}
        {open ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
      </button>
      {open && (
        <div className="border-t border-border p-5">
          {error && <Notice tone="danger">{error}</Notice>}
          {!s && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
          {s && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {num("readinessThreshold", "Readiness cutoff", "0–100. Below this an application is declined with feedback.", 0, 100)}
                {num("scoreFloor", "Match score floor", "Minimum investor match score to include.", 0, 100)}
                {num("maxInvestors", "Investors per campaign", "Upper bound, 1–500.", 1, 500)}
                {num("waveSize", "Wave size", "Investors emailed per send wave.", 1, 200)}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {toggle("autoAssess", "Auto-assess", "Off: received applications wait until you re-assess them by hand.")}
                {toggle("autoSend", "Auto-send", "Off: a matched campaign is held until you release it. Nothing is emailed first.")}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button onClick={save} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium text-white disabled:opacity-60" style={{ background: "var(--accent)" }}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}{saved ? "Saved" : "Save controls"}
                </button>
                <span className="text-xs text-muted-foreground">Takes effect on the next assessment or send — no redeploy.</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function DetailPanel({ id, status, onChanged }: { id: string; status: string; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const reload = useCallback(() => call<Detail>(`campaign/${id}`).then((r) => { setD(r); setError(null) }).catch((e) => setError(e.message)), [id])
  useEffect(() => { reload() }, [reload])

  async function act(action: string) {
    if (action === "reassess" && !confirm("Re-run the whole pipeline? This discards the current campaign and its investor list.")) return
    if (action === "complete" && !confirm("Force-complete this campaign? Outreach stops.")) return
    setBusy(action); setError(null)
    try { await call(`campaign/${id}`, { method: "POST", body: JSON.stringify({ action }) }); await reload(); onChanged() }
    catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  if (error && !d) return <div className="border-t border-border p-4"><Notice tone="danger">{error}</Notice></div>
  if (!d) return <div className="border-t border-border p-4 text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading…</div>
  const c = d.campaign, a = c.assessment
  const held = status === "campaign_ready" && !c.sendApproved
  const active = status === "outreaching" || status === "campaign_ready"
  const Btn = ({ action, icon, text, primary }: { action: string; icon: React.ReactNode; text: string; primary?: boolean }) => (
    <button onClick={() => act(action)} disabled={!!busy}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium disabled:opacity-60 ${primary ? "text-white" : "border border-border hover:bg-muted"}`}
      style={primary ? { background: "var(--accent)" } : undefined}>
      {busy === action ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}{text}
    </button>
  )

  return (
    <div className="border-t border-border px-5 py-4">
      {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
      {c.oneLiner && <p className="mb-3 text-sm">{c.oneLiner}</p>}
      {a && (
        <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4">
          <div className="mb-2 text-sm font-medium">Assessment: {a.verdict === "decline" ? "Declined" : "Passed"} ({a.score}/100)</div>
          {a.summary && <p className="mb-2 text-xs text-muted-foreground">{a.summary}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {!!a.strengths?.length && <List title="Strengths" tone="text-emerald-700" items={a.strengths} />}
            {!!a.gaps?.length && <List title="Gaps" tone="text-amber-700" items={a.gaps} />}
          </div>
        </div>
      )}
      {!a && c.declineReason && <div className="mb-4"><Notice tone="warn">{c.declineReason}</Notice></div>}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {c.hasDeck ? <span className="text-muted-foreground">Deck attached to this application.</span> : <span className="text-amber-700">No deck on file — attach one, then re-assess.</span>}
        <AttachDeck id={id} publicRef={c.publicRef} onDone={reload} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Btn action="reassess" icon={<RotateCw className="h-3.5 w-3.5" />} text="Re-assess" />
        {held && <Btn action="release" icon={<Rocket className="h-3.5 w-3.5" />} text="Release outreach" primary />}
        {active && c.campaignStatus !== "paused" && <Btn action="pause" icon={<Pause className="h-3.5 w-3.5" />} text="Pause sends" />}
        {c.campaignStatus === "paused" && <Btn action="resume" icon={<Play className="h-3.5 w-3.5" />} text="Resume" />}
        {status !== "completed" && status !== "declined" && <Btn action="complete" icon={<CheckCircle2 className="h-3.5 w-3.5" />} text="Force complete" />}
        {held && <span className="text-xs text-amber-700">Held — nothing sends until you release.</span>}
      </div>

      {d.entries.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-3 py-2">Investor</th><th className="px-3 py-2">Match</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Contacted</th><th className="px-3 py-2">Reply</th></tr>
            </thead>
            <tbody>
              {d.entries.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="px-3 py-2"><div className="font-medium">{e.investorName ?? "—"}</div><div className="text-muted-foreground">{e.investorEmail}</div></td>
                  <td className="px-3 py-2 tabular-nums" title={e.rationale ?? undefined}>{e.matchScore ?? "—"}</td>
                  <td className="px-3 py-2">{label(e.stage)}{e.sendError && <div className="text-rose-700">{e.sendError}</div>}</td>
                  <td className="px-3 py-2">{date(e.contactedAt)}{e.openedAt ? " · opened" : ""}</td>
                  <td className="px-3 py-2">{e.interestChoice === "yes" ? <span className="text-emerald-700">Interested</span> : e.interestChoice === "no" ? "Passed" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{status === "declined" ? "Declined before any investor was matched." : "No investors matched yet."}</p>
      )}
    </div>
  )
}

function List({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  return (
    <div>
      <div className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${tone}`}>{title}</div>
      <ul className="space-y-0.5 text-xs text-muted-foreground">{items.map((x, i) => <li key={i}>• {x}</li>)}</ul>
    </div>
  )
}
function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card-elev rounded-xl border border-border p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-[1.75rem] leading-none tabular-nums">{value}</div>
    </div>
  )
}
function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`rounded-full border px-3 py-1 text-xs capitalize ${active ? "border-transparent text-white" : "border-border hover:bg-muted"}`} style={active ? { background: "var(--accent)" } : undefined}>{children}</button>
}
function Notice({ tone, children }: { tone: "danger" | "warn"; children: React.ReactNode }) {
  const cls = tone === "danger" ? "border-rose-300 bg-rose-50 text-rose-800" : "border-amber-300 bg-amber-50 text-amber-800"
  return <div role="alert" className={`flex items-start gap-2 rounded-md border p-3 text-sm ${cls}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{children}</div>
}

function AttachDeck({ id, publicRef, onDone }: { id: string; publicRef: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <>
      <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] hover:bg-muted">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
        {busy ? "Uploading…" : "Attach / replace deck"}
        <input type="file" accept=".pdf,.ppt,.pptx" className="sr-only" disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return
            setBusy(true); setErr(null)
            try { await attachDeckFile(`/api/anker/campaign/${id}/deck`, publicRef, f); onDone() }
            catch (x: any) { setErr(x?.message ?? "Upload failed") }
            finally { setBusy(false); e.target.value = "" }
          }} />
      </label>
      {err && <span role="alert" className="text-[11px] text-rose-700">{err}</span>}
    </>
  )
}
