"use client"

import { useState } from "react"
import { KeyRound, Plus, Loader2, Power, Trash2 } from "lucide-react"

export interface KeyRow {
  id: string
  provider: string
  label: string | null
  last4: string | null
  scope: string
  disabled: boolean
  created_at: string
  rotated_at: string | null
}

const PROVIDERS = ["anthropic", "gemini", "openai", "mistral", "qwen", "resend", "hunter", "other"]
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—")

export function PlatformKeysClient({ initial }: { initial: KeyRow[] }) {
  const [keys, setKeys] = useState(initial)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ provider: "anthropic", label: "", secret: "" })

  async function create() {
    if (!f.secret.trim()) return
    setBusy(true)
    try {
      const res = await fetch("/api/platform-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(f),
      })
      const d = await res.json()
      if (d.key) {
        setKeys((k) => [d.key, ...k])
        setF({ provider: "anthropic", label: "", secret: "" })
        setOpen(false)
      }
    } finally {
      setBusy(false)
    }
  }

  async function toggle(row: KeyRow) {
    const res = await fetch(`/api/platform-keys/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ disabled: !row.disabled }),
    })
    const d = await res.json()
    if (d.key) setKeys((k) => k.map((x) => (x.id === row.id ? d.key : x)))
  }

  async function remove(row: KeyRow) {
    if (!confirm(`Delete the ${row.provider} key ••••${row.last4 ?? ""}? This cannot be undone.`)) return
    const res = await fetch(`/api/platform-keys/${row.id}`, { method: "DELETE" })
    if (res.ok) setKeys((k) => k.filter((x) => x.id !== row.id))
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm text-white"
          style={{ background: "var(--accent)" }}
        >
          <Plus className="w-4 h-4" /> Add key
        </button>
      </div>

      {open && (
        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><KeyRound className="w-4 h-4" /> Add a platform key</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Provider</span>
              <select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-[var(--accent)]">
                {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Label</span>
              <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="prod router key"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-[var(--accent)]" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Secret</span>
              <input type="password" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} placeholder="sk-…"
                className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-[var(--accent)]" />
            </label>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={create} disabled={busy || !f.secret.trim()}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm text-white disabled:opacity-50" style={{ background: "var(--accent)" }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save key
            </button>
            <button onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Encrypted with AES-256-GCM before storage. The raw secret is never shown again — only the last 4 characters.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5">Provider</th>
              <th className="text-left px-4 py-2.5">Label</th>
              <th className="text-left px-4 py-2.5">Secret</th>
              <th className="text-left px-4 py-2.5">Scope</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Added</th>
              <th className="text-right px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No platform keys yet. Add one above.</td></tr>
            ) : keys.map((row) => (
              <tr key={row.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5 font-medium">{row.provider}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{row.label || "—"}</td>
                <td className="px-4 py-2.5 font-mono text-muted-foreground">••••{row.last4 ?? "····"}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{row.scope}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] px-2 py-0.5 rounded ${row.disabled ? "bg-foreground/[0.06] text-muted-foreground" : "text-[var(--ok)]"}`}
                    style={row.disabled ? undefined : { background: "color-mix(in oklab, var(--ok) 15%, transparent)" }}>
                    {row.disabled ? "Disabled" : "Active"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{fmt(row.created_at)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    <button onClick={() => toggle(row)} title={row.disabled ? "Enable" : "Disable"}
                      className="inline-flex items-center h-8 px-2 rounded-md border border-border text-xs hover:border-[var(--accent)]">
                      <Power className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(row)} title="Delete"
                      className="inline-flex items-center h-8 px-2 rounded-md border border-border text-xs hover:border-[var(--danger)] hover:text-[var(--danger)]">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
