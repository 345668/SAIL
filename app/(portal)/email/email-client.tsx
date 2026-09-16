"use client"

/**
 * Ported from Anker components/admin/email-outbox-panel.tsx.
 *
 * Two changes: endpoints move to the portal relay (/api/anker/...), and every
 * request carries x-portal-act-as-user, because these endpoints authenticate as
 * a TENANT USER rather than an admin. The acting user is chosen in the page
 * above and threaded through actAs. See lib/anker-proxy.ts.
 */

import { useEffect, useState, useTransition } from "react"
import {
  Loader2, RefreshCw, AlertTriangle, Send, Eye, MousePointerClick, Clock,
  Mail, CheckCircle2, ArrowRight, ExternalLink, AlarmClock,
} from "lucide-react"

type Bucket = "drafts" | "sent" | "needs_followup" | "failed" | "all"

interface Row {
  id: string
  crmEntryId: string
  partnerName: string | null
  partnerEmail: string | null
  partnerFirm: string | null
  kind: string
  stepNumber: number
  subject: string | null
  body: string
  status: string
  charCount: number
  emailFrom: string | null
  emailTo: string | null
  trackingId: string | null
  opens: number
  clicks: number
  lastOpenedAt: string | null
  lastClickedAt: string | null
  needsFollowup: boolean
  followupDueAt: string | null
  sentAt: string | null
  resendId: string | null
  failedReason: string | null
  generatedBy: string | null
  bucket: "drafts" | "sent" | "needs_followup" | "failed"
}

interface Payload {
  rows: Row[]
  counts: { drafts: number; sent: number; needs_followup: number; failed: number; total: number }
}

interface SyncState {
  configured: boolean
  lastSyncAt: string | null
  activeCount: number
  unsyncedCount: number
}

interface SyncResult {
  configured: boolean
  fetched: number
  updated: number
  newOpens: number
  newClicks: number
  newBounces: number
  newDelivered: number
  newComplained: number
  errors: { messageId: string; error: string }[]
  durationMs: number
}

export function EmailClient({ actAs }: { actAs: string }) {
  /**
   * Every call here runs as a TENANT USER, not as an admin, so the relay needs
   * the subject on each request. Threaded from the page's user picker.
   */
  const afetch = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), "x-portal-act-as-user": actAs },
    })

  const [bucket, setBucket] = useState<Bucket>("drafts")
  const [data, setData] = useState<Payload | null>(null)
  const [loading, startLoad] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SyncState | null>(null)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)
  const [syncing, setSyncing] = useState(false)

  function load(b: Bucket = bucket) {
    setError(null)
    startLoad(async () => {
      try {
        const res = await afetch(`/api/anker/admin/email/outbox?bucket=${b}&limit=200`, { cache: "no-store" })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`)
        setData(json)
      } catch (e: any) { setError(e?.message ?? "Load failed") }
    })
  }
  async function loadSyncState() {
    try {
      const res = await afetch("/api/anker/admin/email/sync-events", { cache: "no-store" })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setSyncState(json)
    } catch {}
  }

  useEffect(() => { load(bucket); loadSyncState() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bucket])

  async function sendRow(row: Row) {
    if (!row.subject || !row.body || !row.partnerEmail) {
      setError("Row missing subject, body, or recipient email.")
      return
    }
    const ok = confirm(`Send to ${row.partnerEmail}?\n\nSubject: ${row.subject}\n\n${row.body.slice(0, 200)}${row.body.length > 200 ? "…" : ""}`)
    if (!ok) return
    setBusy(`send:${row.id}`); setError(null)
    try {
      const res = await afetch("/api/anker/outreach/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: row.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`)
      // refresh
      load(bucket)
    } catch (e: any) { setError(e?.message ?? "Send failed") }
    finally { setBusy(null) }
  }

  async function triggerSync(opts: { force?: boolean } = {}) {
    setSyncing(true); setError(null)
    try {
      const res = await afetch("/api/anker/admin/email/sync-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? `Failed (${res.status})`)
      setLastSyncResult(json)
      loadSyncState()
      load(bucket)
    } catch (e: any) { setError(e?.message ?? "Sync failed") }
    finally { setSyncing(false) }
  }

  return (
    <div className="space-y-5">
      {/* Resend events sync */}
      <div className="border border-foreground/10 rounded-lg p-4 flex items-start gap-3 flex-wrap">
        <Mail className="w-4 h-4 text-muted-foreground mt-0.5" />
        <div className="flex-1 min-w-[200px]">
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Resend events sync</div>
          {!syncState?.configured && (
            <div className="text-[11px] text-amber-700 mt-1">
              Resend not configured — set RESEND_API_KEY in .env.local, then restart Anker.
            </div>
          )}
          {syncState?.configured && (
            <div className="text-[11px] font-mono text-muted-foreground mt-1 space-y-0.5">
              <div>
                {syncState.activeCount} active · {syncState.unsyncedCount} never synced
                {syncState.lastSyncAt && (
                  <span className="ml-2">last sync {new Date(syncState.lastSyncAt).toLocaleTimeString()}</span>
                )}
              </div>
              {lastSyncResult && (
                <div>
                  ↳ fetched {lastSyncResult.fetched} · updated {lastSyncResult.updated} ·
                  {lastSyncResult.newOpens > 0 && <> opens +{lastSyncResult.newOpens} ·</>}
                  {lastSyncResult.newClicks > 0 && <> clicks +{lastSyncResult.newClicks} ·</>}
                  {lastSyncResult.newDelivered > 0 && <> delivered +{lastSyncResult.newDelivered} ·</>}
                  {lastSyncResult.newBounces > 0 && <span className="text-rose-700"> bounces +{lastSyncResult.newBounces} ·</span>}
                  {lastSyncResult.newComplained > 0 && <span className="text-rose-700"> spam +{lastSyncResult.newComplained} ·</span>}
                  {lastSyncResult.errors.length > 0 && <span className="text-rose-700"> errors {lastSyncResult.errors.length}</span>}
                  {lastSyncResult.fetched === 0 && <> nothing to poll</>}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => triggerSync()}
            disabled={syncing || !syncState?.configured}
            className="px-3 py-1.5 text-xs rounded-md border border-foreground/15 hover:bg-foreground/5 disabled:opacity-50 inline-flex items-center gap-1"
            title="Poll Resend for messages last synced > 5 min ago"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync from Resend
          </button>
          <button
            type="button"
            onClick={() => triggerSync({ force: true })}
            disabled={syncing || !syncState?.configured}
            className="px-3 py-1.5 text-xs rounded-md border border-foreground/15 hover:bg-foreground/5 disabled:opacity-50"
            title="Re-poll every sent message regardless of last sync"
          >
            Force all
          </button>
        </div>
      </div>

      {/* Bucket tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["drafts", "sent", "needs_followup", "failed", "all"] as const).map((b) => {
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
              <span className="font-mono uppercase tracking-wider text-[10px]">{b.replace(/_/g, " ")}</span>
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

      {/* Rows */}
      <div className="space-y-3">
        {(data?.rows ?? []).length === 0 && !loading && (
          <div className="text-center text-sm text-muted-foreground py-12 border border-dashed border-foreground/15 rounded-md">
            No emails in this bucket.
          </div>
        )}
        {(data?.rows ?? []).map((row) => (
          <OutboxRow
            key={row.id}
            row={row}
            busy={busy}
            onSend={() => sendRow(row)}
          />
        ))}
      </div>
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  connection_request: "day 0",
  follow_up: "day 3",
  different_angle: "day 7",
  close_loop: "day 14",
}

function OutboxRow({ row, busy, onSend }: { row: Row; busy: string | null; onSend: () => void }) {
  const draft = row.status === "draft"
  const failed = row.status === "failed"
  return (
    <div className="border border-foreground/10 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-display text-base truncate">{row.partnerName ?? "—"}</div>
            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/70">
              {KIND_LABEL[row.kind] ?? row.kind}
            </span>
            <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded ${
              draft ? "bg-cyan-100 text-cyan-700"
              : failed ? "bg-rose-100 text-rose-700"
              : row.status === "replied" ? "bg-violet-100 text-violet-700"
              : "bg-emerald-100 text-emerald-700"
            }`}>{row.status}</span>
            {row.needsFollowup && (
              <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 inline-flex items-center gap-1">
                <AlarmClock className="w-3 h-3" /> needs follow-up
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono text-muted-foreground truncate mt-0.5">
            {row.partnerEmail ?? "(no email)"} {row.partnerFirm ? ` · ${row.partnerFirm}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 text-xs">
          {row.opens > 0 && (
            <span className="inline-flex items-center gap-1 text-emerald-700" title={row.lastOpenedAt ?? ""}>
              <Eye className="w-3.5 h-3.5" /> {row.opens}
            </span>
          )}
          {row.clicks > 0 && (
            <span className="inline-flex items-center gap-1 text-blue-700" title={row.lastClickedAt ?? ""}>
              <MousePointerClick className="w-3.5 h-3.5" /> {row.clicks}
            </span>
          )}
          {row.sentAt && (
            <span className="inline-flex items-center gap-1 text-muted-foreground font-mono text-[10px]">
              <Clock className="w-3 h-3" /> {new Date(row.sentAt).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <div>
        {row.subject && (
          <div className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider mb-1">subject</div>
        )}
        {row.subject && <div className="text-sm font-medium mb-2">{row.subject}</div>}
        <div className="bg-foreground/[0.02] rounded p-3 text-sm whitespace-pre-wrap leading-relaxed">{row.body}</div>
      </div>

      {failed && row.failedReason && (
        <div className="text-[11px] font-mono text-rose-700">error: {row.failedReason}</div>
      )}

      <div className="flex items-center gap-2 flex-wrap text-xs">
        <a
          href={`/dashboard/crm?focus=${row.crmEntryId}`}
          className="px-3 py-1.5 rounded-md border border-foreground/15 hover:bg-foreground/5 text-[11px] font-mono inline-flex items-center gap-1"
        >
          View in CRM <ArrowRight className="w-3 h-3" />
        </a>
        {row.resendId && !row.resendId.startsWith("dryrun:") && (
          <a
            href={`https://resend.com/emails/${row.resendId}`}
            target="_blank" rel="noreferrer"
            className="text-[10px] font-mono text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            resend <ExternalLink className="w-3 h-3" />
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          {draft && (
            <button
              type="button"
              onClick={onSend}
              disabled={busy === `send:${row.id}` || !row.partnerEmail || !row.subject}
              className="px-3 py-1.5 rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 inline-flex items-center gap-1"
              title={!row.partnerEmail ? "Recipient email missing" : !row.subject ? "Subject missing" : "Send via Resend"}
            >
              {busy === `send:${row.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send
            </button>
          )}
          {!draft && row.sentAt && row.opens === 0 && row.clicks === 0 && (
            <span className="text-[10px] font-mono text-muted-foreground inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> sent — no opens yet
            </span>
          )}
        </div>
      </div>

      {row.generatedBy && <div className="text-[10px] font-mono text-muted-foreground">via {row.generatedBy}</div>}
    </div>
  )
}
