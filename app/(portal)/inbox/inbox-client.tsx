"use client"

/**
 * Ported verbatim from Anker components/admin/inbox-panel.tsx.
 * Only change: endpoints move to the portal relay (/api/anker/...), since the
 * engine stays in the tenant app. See lib/anker-proxy.ts.
 */

import { useEffect, useState, useTransition } from "react"
import {
  Loader2, RefreshCw, AlertTriangle, Mail, Sparkles, Check, ExternalLink,
  ArrowRight, MessageSquare,
} from "lucide-react"

type Bucket = "pending" | "classified" | "actioned" | "all"

interface InboxRow {
  id: string
  crmEntryId: string
  partnerName: string | null
  partnerFirm: string | null
  partnerTitle: string | null
  partnerLinkedin: string | null
  inboundText: string
  classification: string | null
  draftResponse: string | null
  recommendedStage: string | null
  reengageOn: string | null
  approved: boolean
  sentAt: string | null
  generatedBy: string | null
  notes: string | null
  receivedAt: string | null
  inReplyToMessageId: string | null
  inReplyToBody: string | null
  status: "pending" | "classified" | "actioned"
}

interface InboxPayload {
  rows: InboxRow[]
  counts: { pending: number; classified: number; actioned: number; total: number }
}

const CLASS_TONE: Record<string, string> = {
  INTERESTED:        "bg-emerald-100 text-emerald-700",
  INTERESTED_LATER:  "bg-cyan-100 text-cyan-700",
  WRONG_FIT:         "bg-rose-100 text-rose-700",
  WRONG_NOW:         "bg-amber-100 text-amber-700",
  QUESTION:          "bg-violet-100 text-violet-700",
}

interface FounderCtx {
  companyName: string
  oneLiner: string
  facts: string[]
  calendarUrl: string
}

const FOUNDER_STORAGE_KEY = "anker:admin:inbox:founder"
function loadFounder(): FounderCtx {
  if (typeof window === "undefined") return { companyName: "", oneLiner: "", facts: [], calendarUrl: "" }
  try { return JSON.parse(localStorage.getItem(FOUNDER_STORAGE_KEY) || "{}") } catch { return { companyName: "", oneLiner: "", facts: [], calendarUrl: "" } }
}
function saveFounder(f: FounderCtx) {
  if (typeof window === "undefined") return
  localStorage.setItem(FOUNDER_STORAGE_KEY, JSON.stringify(f))
}

export function InboxClient() {
  const [data, setData] = useState<InboxPayload | null>(null)
  const [bucket, setBucket] = useState<Bucket>("pending")
  const [loading, startLoad] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [founder, setFounder] = useState<FounderCtx>({ companyName: "", oneLiner: "", facts: [], calendarUrl: "" })
  const [factsText, setFactsText] = useState("")

  useEffect(() => {
    const f = loadFounder()
    setFounder(f)
    setFactsText((f.facts ?? []).join("\n"))
  }, [])

  function load(b: Bucket = bucket) {
    setError(null)
    startLoad(async () => {
      try {
        const res = await fetch(`/api/admin/inbox?status=${b}&limit=200`, { cache: "no-store" })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`)
        setData(json)
      } catch (e: any) { setError(e?.message ?? "Load failed") }
    })
  }
  useEffect(() => { load(bucket) }, [bucket])

  function persistFounder(next: FounderCtx) {
    setFounder(next)
    saveFounder(next)
  }

  async function act(action: "classify" | "approve" | "update", row: InboxRow, extra: any = {}) {
    setBusy(`${action}:${row.id}`); setError(null)
    try {
      const body: any = { action, replyId: row.id, ...extra }
      if (action === "classify") {
        if (!founder.companyName || !founder.oneLiner) {
          throw new Error("Set Company name + one-liner before classifying.")
        }
        body.founder = { ...founder, facts: factsText.split("\n").map((s) => s.trim()).filter(Boolean) }
      }
      const res = await fetch("/api/anker/admin/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`)
      // Patch the row in place so the user sees the new draft immediately.
      if (data) {
        setData({
          ...data,
          rows: data.rows.map((r) => r.id === row.id ? json.row : r),
        })
      }
    } catch (e: any) { setError(e?.message ?? "Action failed") }
    finally { setBusy(null) }
  }

  return (
    <div className="space-y-5">
      {/* Founder context */}
      <details className="border border-foreground/10 rounded-lg p-4 group" open={!founder.companyName}>
        <summary className="cursor-pointer text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" />
          Founder context (used by Classify)
          {founder.companyName && <span className="ml-auto text-foreground/70">{founder.companyName}</span>}
        </summary>
        <div className="grid md:grid-cols-2 gap-3 mt-3 text-xs">
          <label className="space-y-1">
            <div className="font-mono uppercase tracking-wider text-muted-foreground text-[10px]">Company name</div>
            <input
              value={founder.companyName}
              onChange={(e) => persistFounder({ ...founder, companyName: e.target.value })}
              className="w-full h-9 px-2 border border-foreground/15 rounded-md bg-background"
              placeholder="Anker"
            />
          </label>
          <label className="space-y-1">
            <div className="font-mono uppercase tracking-wider text-muted-foreground text-[10px]">Calendar URL</div>
            <input
              value={founder.calendarUrl ?? ""}
              onChange={(e) => persistFounder({ ...founder, calendarUrl: e.target.value })}
              className="w-full h-9 px-2 border border-foreground/15 rounded-md bg-background"
              placeholder="https://cal.com/…"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <div className="font-mono uppercase tracking-wider text-muted-foreground text-[10px]">One-liner</div>
            <input
              value={founder.oneLiner}
              onChange={(e) => persistFounder({ ...founder, oneLiner: e.target.value })}
              className="w-full h-9 px-2 border border-foreground/15 rounded-md bg-background"
              placeholder="LP-discovery + matchmaking for fund managers"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <div className="font-mono uppercase tracking-wider text-muted-foreground text-[10px]">Facts (one per line, classifier picks one)</div>
            <textarea
              value={factsText}
              onChange={(e) => {
                setFactsText(e.target.value)
                persistFounder({ ...founder, facts: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })
              }}
              rows={3}
              className="w-full px-2 py-1.5 border border-foreground/15 rounded-md bg-background font-mono"
              placeholder="$80M ARR · 3 of top 10 funds use us · ex-Stripe + ex-Sequoia team"
            />
          </label>
        </div>
      </details>

      {/* Bucket tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["pending", "classified", "actioned", "all"] as const).map((b) => {
          const n = data?.counts ? (b === "all" ? data.counts.total : (data.counts as any)[b]) : null
          const active = bucket === b
          return (
            <button
              key={b}
              type="button"
              onClick={() => setBucket(b)}
              className={`px-3 py-1.5 text-xs rounded-md border inline-flex items-center gap-2 ${
                active ? "bg-foreground text-background border-foreground" : "border-foreground/15 hover:bg-foreground/5"
              }`}
            >
              <span className="font-mono uppercase tracking-wider text-[10px]">{b}</span>
              {n !== null && <span className={`text-[10px] font-mono ${active ? "opacity-70" : "text-muted-foreground"}`}>{n}</span>}
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => load(bucket)}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-md border border-foreground/15 hover:bg-foreground/5 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="text-rose-700 dark:text-rose-400">{error}</span>
        </div>
      )}

      {/* Row list */}
      <div className="space-y-3">
        {(data?.rows ?? []).length === 0 && !loading && (
          <div className="text-center text-sm text-muted-foreground py-12 border border-dashed border-foreground/15 rounded-md">
            No replies in this bucket.
          </div>
        )}
        {(data?.rows ?? []).map((row) => (
          <ReplyRow
            key={row.id}
            row={row}
            busy={busy}
            onClassify={() => act("classify", row)}
            onApprove={(markSent) => act("approve", row, { markSent })}
            onUpdate={(patch) => act("update", row, patch)}
          />
        ))}
      </div>
    </div>
  )
}

function ReplyRow({ row, busy, onClassify, onApprove, onUpdate }: {
  row: InboxRow
  busy: string | null
  onClassify: () => void
  onApprove: (markSent: boolean) => void
  onUpdate: (patch: { draft?: string; classification?: string; recommendedStage?: string }) => void
}) {
  const [draftLocal, setDraftLocal] = useState(row.draftResponse ?? "")
  const [showOriginal, setShowOriginal] = useState(false)
  useEffect(() => { setDraftLocal(row.draftResponse ?? "") }, [row.draftResponse])

  const cls = row.classification
  const tone = cls ? CLASS_TONE[cls] : "bg-foreground/5 text-foreground/60"

  function copyDraft() {
    if (!draftLocal) return
    navigator.clipboard?.writeText(draftLocal).catch(() => {})
  }

  const dirty = draftLocal !== (row.draftResponse ?? "")

  return (
    <div className="border border-foreground/10 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-base truncate">{row.partnerName ?? "—"}</div>
          <div className="text-[11px] font-mono text-muted-foreground truncate">
            {row.partnerTitle ?? "—"} {row.partnerFirm ? ` · ${row.partnerFirm}` : ""}
          </div>
          {row.partnerLinkedin && (
            <a
              href={row.partnerLinkedin}
              target="_blank" rel="noreferrer"
              className="text-[10px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-0.5"
            >
              linkedin <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {cls && (
            <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${tone}`}>
              {cls.toLowerCase()}
            </span>
          )}
          {row.recommendedStage && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/70">
              <ArrowRight className="w-2.5 h-2.5 inline-block mr-0.5" />
              {row.recommendedStage}
            </span>
          )}
          {row.approved && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> approved
            </span>
          )}
        </div>
      </div>

      {/* Their reply */}
      <div className="bg-foreground/[0.02] rounded p-3">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
          <Mail className="w-3 h-3" /> inbound
          <span className="ml-auto opacity-70">{row.receivedAt ? new Date(row.receivedAt).toLocaleString() : ""}</span>
        </div>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{row.inboundText}</div>
        {row.inReplyToBody && (
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            className="mt-2 text-[10px] font-mono text-muted-foreground hover:text-foreground"
          >
            {showOriginal ? "hide" : "show"} our original DM →
          </button>
        )}
        {showOriginal && row.inReplyToBody && (
          <div className="mt-2 border-l-2 border-foreground/15 pl-2 text-xs text-muted-foreground whitespace-pre-wrap">
            {row.inReplyToBody}
          </div>
        )}
      </div>

      {/* Draft */}
      {(row.classification || draftLocal) && (
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
            <MessageSquare className="w-3 h-3" /> our draft
            <span className="ml-auto text-foreground/40">{draftLocal.length} / 320</span>
          </div>
          <textarea
            value={draftLocal}
            onChange={(e) => setDraftLocal(e.target.value)}
            rows={3}
            className="w-full px-2 py-1.5 border border-foreground/15 rounded-md bg-background text-sm leading-relaxed"
          />
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button
          type="button"
          onClick={onClassify}
          disabled={busy === `classify:${row.id}`}
          className="px-3 py-1.5 rounded-md border border-foreground/15 hover:bg-foreground/5 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {busy === `classify:${row.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {row.classification ? "Re-classify" : "Classify"}
        </button>
        {dirty && (
          <button
            type="button"
            onClick={() => onUpdate({ draft: draftLocal })}
            disabled={busy === `update:${row.id}`}
            className="px-3 py-1.5 rounded-md border border-foreground/15 hover:bg-foreground/5 disabled:opacity-50 inline-flex items-center gap-1"
          >
            {busy === `update:${row.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Save edits
          </button>
        )}
        <button
          type="button"
          onClick={copyDraft}
          disabled={!draftLocal}
          className="px-3 py-1.5 rounded-md border border-foreground/15 hover:bg-foreground/5 disabled:opacity-50"
        >
          Copy draft
        </button>
        <div className="ml-auto flex items-center gap-2">
          {!row.approved && (
            <>
              <button
                type="button"
                onClick={() => onApprove(false)}
                disabled={busy === `approve:${row.id}` || !row.classification}
                className="px-3 py-1.5 rounded-md border border-foreground/15 hover:bg-foreground/5 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={() => onApprove(true)}
                disabled={busy === `approve:${row.id}` || !row.classification}
                className="px-3 py-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1"
                title="Approve and mark as sent — advances the CRM stage."
              >
                <Check className="w-3.5 h-3.5" /> Approve + sent
              </button>
            </>
          )}
          <a
            href={`/dashboard/crm?focus=${row.crmEntryId}`}
            className="px-3 py-1.5 rounded-md border border-foreground/15 hover:bg-foreground/5 text-[11px] font-mono inline-flex items-center gap-1"
          >
            View in CRM <ArrowRight className="w-3 h-3" />
          </a>
        </div>
      </div>

      {row.generatedBy && (
        <div className="text-[10px] font-mono text-muted-foreground">via {row.generatedBy}</div>
      )}
    </div>
  )
}
