"use client"

import { useState } from "react"
import { Plus, Loader2, Trash2, Power } from "lucide-react"

export interface Theme {
  id: string
  name: string
  slug: string
  description: string | null
  keywords: string[]
  enabled: boolean
  position: number | null
}

export function ThemesClient({ initial }: { initial: Theme[] }) {
  const [themes, setThemes] = useState(initial)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ name: "", description: "", keywords: "" })

  async function create() {
    if (!f.name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch("/api/newsroom/themes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: f.name, description: f.description, keywords: f.keywords }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "save failed")
      setThemes((t) => {
        const rest = t.filter((x) => x.id !== d.theme.id)
        return [...rest, d.theme]
      })
      setF({ name: "", description: "", keywords: "" })
      setOpen(false)
    } catch (e: any) {
      setErr(e?.message || "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function toggle(row: Theme) {
    setRowBusy(row.id)
    try {
      const res = await fetch(`/api/newsroom/themes/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !row.enabled }),
      })
      const d = await res.json()
      if (d.theme) setThemes((t) => t.map((x) => (x.id === row.id ? d.theme : x)))
    } finally {
      setRowBusy(null)
    }
  }

  async function remove(row: Theme) {
    if (!confirm(`Delete the “${row.name}” theme?`)) return
    setRowBusy(row.id)
    try {
      const res = await fetch(`/api/newsroom/themes/${row.id}`, { method: "DELETE" })
      if (res.ok) setThemes((t) => t.filter((x) => x.id !== row.id))
    } finally {
      setRowBusy(null)
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
          <Plus className="w-4 h-4" /> New theme
        </button>
      </div>

      {open && (
        <div className="mb-6 card-elev rounded-xl border border-border p-5 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Name</span>
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Venture Capital"
                className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-[var(--accent)]" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Description</span>
              <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })}
                className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-[var(--accent)]" />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Keywords — comma separated</span>
            <input value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} placeholder="venture capital, emerging manager, fund launch"
              className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-[var(--accent)]" />
          </label>
          <div className="flex items-center gap-3">
            <button onClick={create} disabled={busy || !f.name.trim()}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm disabled:opacity-50"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save theme
            </button>
            <button onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            {err && <span className="text-sm text-[var(--danger)]">{err}</span>}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        {themes.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground sm:col-span-2">No themes yet.</div>
        ) : themes.map((t) => (
          <div key={t.id} className={`card-elev rounded-xl border border-border p-4 ${t.enabled ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{t.name}</div>
                {t.description && <div className="text-xs text-muted-foreground mt-0.5">{t.description}</div>}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button onClick={() => toggle(t)} disabled={rowBusy === t.id} title={t.enabled ? "Disable" : "Enable"}
                  className="inline-flex items-center h-8 px-2 rounded-md border border-border text-xs hover:border-[var(--accent)] disabled:opacity-50">
                  {rowBusy === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => remove(t)} disabled={rowBusy === t.id} title="Delete"
                  className="inline-flex items-center h-8 px-2 rounded-md border border-border text-xs hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {t.keywords.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {t.keywords.map((k) => (
                  <span key={k} className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px]">{k}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
