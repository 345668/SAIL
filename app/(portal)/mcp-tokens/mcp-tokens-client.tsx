"use client"

/**
 * Ported verbatim from Anker's components/admin/mcp-tokens-panel.tsx so the
 * tool looks and behaves exactly as it does in the tenant app. Two deliberate
 * differences:
 *   • API moves from /api/admin/mcp-tokens to /api/mcp-tokens (the whole portal
 *     is already superuser-gated, so the extra segment is redundant here).
 *   • "acts as user id" has no owner default — a portal staff id is not a
 *     tenant user id, so it must be supplied explicitly.
 */

import { useCallback, useEffect, useState } from "react"

interface TokenRow {
  id: string
  user_id: string
  workspace_id: string | null
  readonly: boolean
  tools: string[] | null
  label: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

const API = "/api/mcp-tokens"

export function McpTokensClient() {
  const [rows, setRows] = useState<TokenRow[]>([])
  const [warning, setWarning] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [revealed, setRevealed] = useState<{ token: string; label: string | null } | null>(null)
  const [form, setForm] = useState({ label: "", userId: "", workspaceId: "", readonly: false, tools: "" })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(API, { cache: "no-store" })
      const d = await r.json()
      setRows(Array.isArray(d.tokens) ? d.tokens : [])
      setWarning(d.warning ?? null)
    } catch {
      setWarning("Failed to load tokens.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setRevealed(null)
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: form.label || null,
          userId: form.userId || undefined,
          workspaceId: form.workspaceId || null,
          readonly: form.readonly,
          tools: form.tools || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) { setWarning(d.error || "Create failed."); return }
      setRevealed({ token: d.token, label: d.row?.label ?? form.label ?? null })
      setForm({ label: "", userId: "", workspaceId: "", readonly: false, tools: "" })
      load()
    } finally {
      setCreating(false)
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Any agent using it loses access immediately.")) return
    await fetch(`${API}/${id}`, { method: "DELETE" })
    load()
  }

  const inputCls = "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
  const label = (t: string) => <span className="font-mono text-[11px] uppercase tracking-wide text-neutral-500">{t}</span>

  return (
    <div className="space-y-8">
      {warning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {warning}
        </div>
      )}

      {revealed && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
          <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
            Token created{revealed.label ? ` — ${revealed.label}` : ""}. Copy it now — it will not be shown again.
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-white px-3 py-2 font-mono text-xs dark:bg-neutral-900">{revealed.token}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(revealed.token)}
              className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
            >Copy</button>
          </div>
          <div className="mt-2 text-xs text-emerald-800/80 dark:text-emerald-300/80">
            Use as <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> against <code className="font-mono">/api/mcp</code>.
          </div>
        </div>
      )}

      {/* Issue form */}
      <form onSubmit={create} className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="mb-3 text-sm font-semibold">Issue a token</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>{label("label")}<input className={inputCls} placeholder="dsh — research bot" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></div>
          <div>{label("acts as user id")}<input className={inputCls} placeholder="tenant user id (required)" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} /></div>
          <div>{label("workspace id (optional)")}<input className={inputCls} placeholder="ws_…" value={form.workspaceId} onChange={(e) => setForm({ ...form, workspaceId: e.target.value })} /></div>
          <div>{label("tool allowlist (csv, optional)")}<input className={inputCls} placeholder="query_investors, score_investors" value={form.tools} onChange={(e) => setForm({ ...form, tools: e.target.value })} /></div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.readonly} onChange={(e) => setForm({ ...form, readonly: e.target.checked })} />
          Read-only (hide mutating tools: crm_add_task, crm_update_stage)
        </label>
        <button type="submit" disabled={creating} className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-60 dark:bg-white dark:text-neutral-900">
          {creating ? "Issuing…" : "Issue token"}
        </button>
      </form>

      {/* List */}
      <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left font-mono text-[11px] uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
            <tr>
              {["label", "acts as", "workspace", "scope", "created", "last used", ""].map((h) => (
                <th key={h} className="px-3 py-2 font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-500">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-500">No tokens yet.</td></tr>}
            {rows.map((t) => {
              const revoked = !!t.revoked_at
              return (
                <tr key={t.id} className={`border-b border-neutral-100 dark:border-neutral-900 ${revoked ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">{t.label || <span className="text-neutral-400">—</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{t.user_id}</td>
                  <td className="px-3 py-2 font-mono text-xs">{t.workspace_id || <span className="text-neutral-400">—</span>}</td>
                  <td className="px-3 py-2 text-xs">
                    {t.readonly && <span className="mr-1 rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">read-only</span>}
                    {t.tools?.length ? <span className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{t.tools.length} tools</span> : <span className="text-neutral-400">all tools</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-xs text-neutral-500">{t.last_used_at ? new Date(t.last_used_at).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {revoked
                      ? <span className="text-xs text-neutral-400">revoked</span>
                      : <button onClick={() => revoke(t.id)} className="rounded-md border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40">Revoke</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
