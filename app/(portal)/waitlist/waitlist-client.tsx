"use client"

/**
 * Console for the tenant's early-access queue.
 *
 * Every state change goes through /api/anker/admin/waitlist, so the lifecycle
 * rules (what can be invited, what a resend does, how long a link lives) are
 * the tenant's single implementation. This file holds no rules of its own — it
 * renders what the tenant reports and asks it to act.
 */

import { useCallback, useEffect, useState, useTransition } from "react"
import { Loader2, AlertTriangle, Send, Ban, Check, X, RotateCw } from "lucide-react"

const STATES = ["pending", "approved", "invited", "accepted", "declined", "revoked"] as const
type State = (typeof STATES)[number]
type Action = "approve" | "decline" | "invite" | "revoke"

interface Row {
  id: string
  name: string | null
  email: string
  persona: string | null
  company: string | null
  status: string
  referral_source: string | null
  created_at: string
  invited_at: string | null
  invite_expires_at: string | null
  accepted_at: string | null
  invite_error: string | null
}

interface Page {
  rows: Row[]
  counts: Record<string, number>
  hasMore: boolean
  page: number
  status: State | null
  ttl: { default: number; min: number; max: number }
}

const TONES: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  approved: "bg-sky-100 text-sky-700",
  invited: "bg-amber-100 text-amber-700",
  accepted: "bg-emerald-100 text-emerald-700",
  declined: "bg-slate-100 text-slate-500",
  revoked: "bg-rose-100 text-rose-700",
}

const date = (value: string) => new Date(value).toLocaleDateString("en-GB")

/** The status column reads as a fact with a date, not just a word. */
function describe(row: Row): string {
  if (row.accepted_at) return `Accepted ${date(row.accepted_at)}`
  if (row.status === "invited" && row.invite_expires_at) {
    return new Date(row.invite_expires_at).getTime() < Date.now()
      ? `Link expired ${date(row.invite_expires_at)}`
      : `Link valid to ${date(row.invite_expires_at)}`
  }
  if (row.status === "approved") return "Not yet invited"
  return ""
}

export function WaitlistClient() {
  const [data, setData] = useState<Page | null>(null)
  const [filter, setFilter] = useState<State | null>(null)
  const [page, setPage] = useState(1)
  const [days, setDays] = useState<string>("")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [loading, start] = useTransition()

  const load = useCallback(() => {
    start(async () => {
      setError(null)
      try {
        const params = new URLSearchParams({ page: String(page) })
        if (filter) params.set("status", filter)
        const res = await fetch(`/api/anker/admin/waitlist?${params}`, { cache: "no-store" })
        const body = await res.json()
        if (!res.ok) { setError(body?.error ?? `Request failed (${res.status})`); return }
        setData(body)
        // Adopt the tenant's configured default the first time we see it, so
        // the field shows what WAITLIST_INVITE_TTL_DAYS is actually set to
        // rather than a number guessed here.
        setDays(current => current || String(body?.ttl?.default ?? ""))
      } catch (e: any) {
        setError(e?.message ?? "Could not reach the portal relay.")
      }
    })
  }, [filter, page])

  useEffect(load, [load])

  function act(action: Action, row: Row, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusyRow(row.id)
    setError(null); setNotice(null)
    ;(async () => {
      try {
        const res = await fetch("/api/anker/admin/waitlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, id: row.id, ttlDays: Number(days) || undefined }),
        })
        const body = await res.json()
        if (!res.ok) setError(body?.message ?? body?.error ?? `Request failed (${res.status})`)
        else setNotice(body?.message ?? "Done.")
      } catch (e: any) {
        setError(e?.message ?? "Could not reach the portal relay.")
      } finally {
        setBusyRow(null)
        load()
      }
    })()
  }

  const total = Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0)
  const btn = "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-40"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[{ label: "All", value: null as State | null, n: total },
          ...STATES.map(s => ({ label: s[0].toUpperCase() + s.slice(1), value: s as State | null, n: data?.counts[s] ?? 0 }))]
          .map(tab => (
            <button key={tab.label} type="button"
              onClick={() => { setFilter(tab.value); setPage(1) }}
              aria-pressed={filter === tab.value}
              className={`rounded-md border px-3 py-1.5 text-xs ${filter === tab.value ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted"}`}>
              {tab.label} <span className="tabular-nums opacity-70">{tab.n}</span>
            </button>
          ))}
        <button type="button" onClick={load} disabled={loading} className={`${btn} ml-auto`}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />} Refresh
        </button>
      </div>

      <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Invitation links expire after
        <input type="number" inputMode="numeric" value={days} onChange={e => setDays(e.target.value)}
          min={data?.ttl.min ?? 1} max={data?.ttl.max ?? 90}
          className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm tabular-nums text-foreground" />
        days.
        <span>
          The tenant&apos;s default is {data?.ttl.default ?? "—"} days, set by{" "}
          <code className="font-mono">WAITLIST_INVITE_TTL_DAYS</code> in the Anker app. Changing it here
          applies to the next send only; anything outside {data?.ttl.min ?? 1}–{data?.ttl.max ?? 90} falls back to the default.
        </span>
      </label>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]" />
          <span>{error}</span>
        </div>
      )}
      {notice && !error && <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">{notice}</div>}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Early-access requests, page {data?.page ?? 1}</caption>
          <thead className="bg-muted/40 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>{["Applicant", "Persona", "Company", "Status", "Source", "Received", "Actions"].map(h => (
              <th key={h} scope="col" className="whitespace-nowrap px-4 py-3">{h}</th>))}</tr>
          </thead>
          <tbody>
            {data?.rows.map(row => {
              const busy = busyRow === row.id
              return (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="px-4 py-3">
                    <div>{row.name || "—"}</div>
                    <a className="text-xs text-muted-foreground underline" href={`mailto:${row.email}`}>{row.email}</a>
                  </td>
                  <td className="px-4 py-3">{row.persona || "—"}</td>
                  <td className="px-4 py-3">{row.company || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${TONES[row.status] ?? "bg-slate-100 text-slate-700"}`}>{row.status}</span>
                    {describe(row) && <div className="mt-1 text-xs text-muted-foreground">{describe(row)}</div>}
                    {row.invite_error && <div className="mt-1 text-xs text-[var(--danger)]">Last send failed. No access was granted.</div>}
                  </td>
                  <td className="max-w-56 break-words px-4 py-3 text-xs text-muted-foreground">{row.referral_source || "direct"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{date(row.created_at)}</td>
                  <td className="px-4 py-3">
                    {row.status === "accepted" ? <span className="text-xs text-muted-foreground">Account created</span> : (
                      <div className="flex flex-wrap gap-1.5">
                        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                        {row.status === "pending" && <>
                          <button type="button" disabled={busy} className={btn} onClick={() => act("approve", row)}><Check className="h-3.5 w-3.5" /> Approve</button>
                          <button type="button" disabled={busy} className={btn} onClick={() => act("decline", row)}><X className="h-3.5 w-3.5" /> Decline</button>
                        </>}
                        {(row.status === "approved" || row.status === "revoked") &&
                          <button type="button" disabled={busy} className={btn} onClick={() => act("invite", row)}><Send className="h-3.5 w-3.5" /> Send invitation</button>}
                        {row.status === "invited" && <>
                          <button type="button" disabled={busy} className={btn}
                            onClick={() => act("invite", row, "Resending replaces the current link. The one already sent will stop working. Continue?")}>
                            <Send className="h-3.5 w-3.5" /> Resend</button>
                          <button type="button" disabled={busy} className={btn}
                            onClick={() => act("revoke", row, "Revoke this invitation? The link stops working immediately.")}>
                            <Ban className="h-3.5 w-3.5" /> Revoke</button>
                        </>}
                        {row.status === "declined" &&
                          <button type="button" disabled={busy} className={btn} onClick={() => act("approve", row)}><Check className="h-3.5 w-3.5" /> Reopen</button>}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {!data?.rows.length && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                {loading ? "Loading…" : "No requests here."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <button type="button" className={btn} disabled={(data?.page ?? 1) <= 1 || loading} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
        <span className="text-muted-foreground">Page {data?.page ?? 1}</span>
        <button type="button" className={btn} disabled={!data?.hasMore || loading} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>
    </div>
  )
}
