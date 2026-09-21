"use client"

import { useMemo, useState } from "react"
import { Loader2, Check, RotateCcw, KeyRound, ShieldAlert, RefreshCw } from "lucide-react"
import { AI_TASKS, PROVIDERS, type AiRouterConfig } from "@/lib/ai-tasks"

const TIER_LABEL: Record<string, string> = { fast: "Fast", balanced: "Balanced", deep: "Deep" }

interface KeyStatus { name: string; set: boolean; last4: string | null; encrypted: boolean }

const KEY_META: Record<string, { label: string; hint: string }> = {
  qwenApiKey: { label: "Qwen — Alibaba Model Studio", hint: "DashScope compatible-mode key. Pair it with the workspace id below when the key is workspace-scoped (sk-ws-…)." },
  anthropicApiKey: { label: "Anthropic", hint: "Claude models." },
  openaiApiKey: { label: "OpenAI", hint: "GPT models and embeddings." },
  geminiApiKey: { label: "Google Gemini", hint: "Gemini models." },
  mistralApiKey: { label: "Mistral", hint: "Currently the forced provider unless you change it above." },
}

export function AiConfigClient({ initial, keys, canEncrypt }: { initial: AiRouterConfig; keys: KeyStatus[]; canEncrypt: boolean }) {
  const [keyState, setKeyState] = useState<KeyStatus[]>(keys)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [cfg, setCfg] = useState<AiRouterConfig>(initial)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reprobing, setReprobing] = useState(false)
  const [reprobed, setReprobed] = useState(false)

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

  /**
   * Tell the tenant to look again.
   *
   * Everything else on this page takes effect by writing the shared config —
   * the tenant re-reads it within seconds. The resolved PROVIDER is different:
   * it is memoised in the tenant's process, so starting Ollama or rotating a
   * key outside this page leaves it serving the old answer until something
   * resets it. Relayed through /api/anker because the thing being reset is in
   * that process, not in a table.
   */
  async function reprobe() {
    setReprobing(true); setErr(null); setReprobed(false)
    try {
      const res = await fetch("/api/anker/admin/system", { method: "POST" })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `re-probe failed (${res.status})`)
      setReprobed(true)
    } catch (e: any) {
      setErr(e?.message ?? "Re-probe failed")
    } finally {
      setReprobing(false)
    }
  }

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch("/api/ai-config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // Only keys the operator actually typed are sent. An untouched field
        // must not post an empty string, which would clear a stored key.
        body: JSON.stringify({
          enabled: cfg.enabled,
          modelOverride: cfg.modelOverride,
          providerOverride: cfg.providerOverride,
          providerStrict: cfg.providerStrict,
          qwenWorkspaceId: cfg.qwenWorkspaceId ?? "",
          ...Object.fromEntries(Object.entries(drafts).filter(([, v]) => v !== undefined)),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "save failed")
      setCfg({ ...cfg, ...d.config })
      if (Array.isArray(d.keys)) setKeyState(d.keys)
      setDrafts({})
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
      <section className="card-elev rounded-xl border border-border p-5">
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

      {/* Provider credentials */}
      <section className="card-elev rounded-xl border border-border p-5">
        <h2 className="flex items-center gap-2 font-display text-lg"><KeyRound className="h-4 w-4" /> Provider keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The credentials the tenant app uses for every AI task, including Call Intelligence. Stored encrypted under{" "}
          <code className="font-mono">CONFIG_ENC_KEY</code>; they are never sent back to this page and never written to
          the audit log. Paste a value to set or rotate it, and leave a field blank to keep what is stored.
        </p>
        {!canEncrypt && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-md border p-3 text-sm" style={{ borderColor: "color-mix(in oklab, var(--danger) 35%, transparent)", background: "color-mix(in oklab, var(--danger) 6%, transparent)" }}>
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--danger)" }} />
            <span>CONFIG_ENC_KEY is not set on this deployment, so keys cannot be stored. Saving one will be refused rather than written in the clear.</span>
          </p>
        )}
        <div className="mt-4 space-y-4">
          {keyState.map((k) => (
            <div key={k.name} className="border-t border-border pt-4 first:border-0 first:pt-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm">{KEY_META[k.name]?.label ?? k.name}</span>
                {k.set
                  ? <span className="rounded px-1.5 py-0.5 text-[11px]" style={k.encrypted
                      ? { background: "color-mix(in oklab, var(--ok) 15%, transparent)", color: "var(--ok)" }
                      : { background: "color-mix(in oklab, var(--danger) 12%, transparent)", color: "var(--danger)" }}>
                      {k.encrypted ? "stored · encrypted" : `stored · PLAINTEXT ••••${k.last4 ?? ""}`}
                    </span>
                  : <span className="text-[11px] text-muted-foreground">not set</span>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{KEY_META[k.name]?.hint}</p>
              <input
                type="password" autoComplete="off" spellCheck={false}
                value={drafts[k.name] ?? ""}
                onChange={(e) => { setDrafts((p) => ({ ...p, [k.name]: e.target.value })); setDirty(true) }}
                placeholder={k.set ? "Paste a new value to rotate" : "Paste API key"}
                className="mt-2 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </div>
          ))}
          <div className="border-t border-border pt-4">
            <label className="block text-sm">Qwen workspace id
              <input
                value={String(cfg.qwenWorkspaceId ?? "")}
                onChange={(e) => mutate((c) => ({ ...c, qwenWorkspaceId: e.target.value }))}
                placeholder="llm-…"
                className="mt-2 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
            <p className="mt-1 text-xs text-muted-foreground">An identifier, not a credential, so it is stored and shown in the clear.</p>
          </div>
        </div>
        {keyState.some((k) => k.set && !k.encrypted) && (
          <p className="mt-4 text-xs" style={{ color: "var(--danger)" }}>
            A stored key is still in plaintext from before encryption was added. Saving anything on this page re-encrypts it in place — you do not need the value again.
          </p>
        )}
      </section>

      {/* Per-task table */}
      {groups.map(([group, tasks]) => (
        <section key={group}>
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{group}</h3>
          <div className="overflow-x-auto card-elev rounded-xl border border-border">
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
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm text-[var(--primary-foreground)] disabled:opacity-50"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
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
        <button
          onClick={reprobe}
          disabled={reprobing}
          title="Re-probe the tenant's provider. Needed after starting a local daemon or rotating a key elsewhere — the resolved provider is cached in that process."
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {reprobing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Reconnect
        </button>
        {reprobed && <span className="text-sm" style={{ color: "var(--ok)" }}>Provider re-probed.</span>}
        {saved && !dirty && <span className="text-sm" style={{ color: "var(--ok)" }}>Saved.</span>}
        {err && <span className="text-sm text-[var(--danger)]">{err}</span>}
      </div>
    </div>
  )
}
