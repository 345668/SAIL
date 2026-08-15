"use client"

import { useMemo, useState } from "react"
import { Loader2, Check, RotateCcw } from "lucide-react"
import { AI_TASKS, PROVIDERS, type AiRouterConfig } from "@/lib/ai-tasks"

const TIER_LABEL: Record<string, string> = { fast: "Fast", balanced: "Balanced", deep: "Deep" }

export function AiConfigClient({ initial }: { initial: AiRouterConfig }) {
  const [cfg, setCfg] = useState<AiRouterConfig>(initial)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const groups = useMemo(() => {
    const m = new Map<string, typeof AI_TASKS>()
    for (const t of AI_TASKS) {
      if (!m.has(t.group)) m.set(t.group, [])
      m.get(t.group)!.push(t)
    }
    return Array.from(m.entries())
  }, [])

  function mutate(fn: (c: AiRouterConfig) => AiRouterConfig) {
    setCfg((c) => fn({ ...c, enabled: { ...c.enabled }, modelOverride: { ...c.modelOverride } }))
    setDirty(true)
    setSaved(false)
  }

  const isEnabled = (task: string) => cfg.enabled[task] !== false

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch("/api/ai-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: cfg.enabled,
          modelOverride: cfg.modelOverride,
          providerOverride: cfg.providerOverride,
          providerStrict: cfg.providerStrict,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "save failed")
      setCfg({ ...cfg, ...d.config })
      setDirty(false)
      setSaved(true)
    } catch (e: any) {
      setErr(e?.message || "save failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Provider force */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-lg">Provider</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Force one provider for every task, or leave on auto (env + key auto-detect chain).
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Force provider</span>
            <select
              value={cfg.providerOverride ?? ""}
              onChange={(e) => mutate((c) => ({ ...c, providerOverride: e.target.value || null }))}
              className="h-9 w-56 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="">Auto (recommended)</option>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm mt-5">
            <input
              type="checkbox"
              checked={!!cfg.providerStrict}
              onChange={(e) => mutate((c) => ({ ...c, providerStrict: e.target.checked }))}
              className="accent-[var(--accent)] w-4 h-4"
            />
            Strict — pin the forced provider with no failover
          </label>
        </div>
      </section>

      {/* Per-task table */}
      {groups.map(([group, tasks]) => (
        <section key={group}>
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{group}</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-4 py-2.5">Task</th>
                  <th className="text-left px-4 py-2.5">Tier</th>
                  <th className="text-left px-4 py-2.5">Model override</th>
                  <th className="text-right px-4 py-2.5">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.task} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{t.label}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{t.task}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] uppercase tracking-wider border border-border rounded px-1.5 py-0.5">
                        {TIER_LABEL[t.tier]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        value={cfg.modelOverride[t.task] ?? ""}
                        onChange={(e) =>
                          mutate((c) => ({ ...c, modelOverride: { ...c.modelOverride, [t.task]: e.target.value } }))
                        }
                        placeholder="tier default"
                        className="h-8 w-48 rounded-md border border-border bg-background px-2.5 text-xs font-mono outline-none focus:border-[var(--accent)]"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <button
                          onClick={() => mutate((c) => ({ ...c, enabled: { ...c.enabled, [t.task]: !isEnabled(t.task) } }))}
                          className={`relative h-5 w-9 rounded-full transition-colors ${isEnabled(t.task) ? "bg-[var(--accent)]" : "bg-foreground/15"}`}
                          role="switch"
                          aria-checked={isEnabled(t.task)}
                          title={isEnabled(t.task) ? "Enabled — click to turn off" : "Off — callers fall back to heuristics"}
                        >
                          <span
                            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isEnabled(t.task) ? "left-[18px]" : "left-0.5"}`}
                          />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {/* Save bar */}
      <div className="sticky bottom-0 -mx-6 lg:-mx-10 border-t border-border bg-background/90 backdrop-blur px-6 lg:px-10 py-3 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm text-white disabled:opacity-50"
          style={{ background: "var(--accent)" }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save changes
        </button>
        {dirty && (
          <button
            onClick={() => { setCfg(initial); setDirty(false); setErr(null) }}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Discard
          </button>
        )}
        {saved && !dirty && <span className="text-sm" style={{ color: "var(--ok)" }}>Saved.</span>}
        {err && <span className="text-sm text-[var(--danger)]">{err}</span>}
      </div>
    </div>
  )
}
