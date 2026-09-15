"use client"

/**
 * Anker has no UI for integration keys — only the API — so this follows the
 * portal's own platform-keys idiom rather than porting a screen.
 *
 * Values are never displayed: each row shows whether the key is set, where it
 * resolves from (DB beats env), and a last-4 hint. Saving a blank value clears
 * the DB entry so the env fallback resumes.
 */
import { useState } from "react"
import { Loader2, Database, Server, Minus } from "lucide-react"

export interface KeyStatus { set: boolean; source: "db" | "env" | null; hint: string | null }
export interface Status { encryptionConfigured: boolean; keys: Record<string, KeyStatus> }

export function IntegrationKeysClient({ initial, names }: { initial: Status; names: string[] }) {
  const [status, setStatus] = useState<Status>(initial)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function save(name: string, value: string) {
    setBusy(name); setError(null); setSaved(null)
    try {
      const res = await fetch("/api/integration-keys", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [name]: value }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error || `HTTP ${res.status}`)
      setStatus({ encryptionConfigured: d.encryptionConfigured, keys: d.keys })
      setDrafts((p) => ({ ...p, [name]: "" }))
      setSaved(value ? `${name} saved` : `${name} cleared — falling back to env`)
    } catch (e: any) {
      setError(e?.message || "Save failed")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {!status.encryptionConfigured && (
        <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-4 text-sm">
          <div className="font-semibold text-[var(--danger)]">CONFIG_ENC_KEY is not set</div>
          <p className="mt-1 text-muted-foreground">
            Keys cannot be stored encrypted, so editing is disabled. Every integration below
            falls back to its environment variable until the key is configured — and it must
            match the tenant app&apos;s value, or saved keys will not decrypt there.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}
      {saved && (
        <div className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          {saved}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Key</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">New value</th>
              <th className="px-3 py-2 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {names.map((name) => {
              const s = status.keys[name] ?? { set: false, source: null, hint: null }
              return (
                <tr key={name}>
                  <td className="px-3 py-2 font-mono text-xs">{name}</td>
                  <td className="px-3 py-2 text-xs">
                    {s.source === "db" && (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Database className="h-3 w-3" /> database · {s.hint}
                      </span>
                    )}
                    {s.source === "env" && (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Server className="h-3 w-3" /> env · {s.hint}
                      </span>
                    )}
                    {!s.source && (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground/60">
                        <Minus className="h-3 w-3" /> not set
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="password"
                      autoComplete="off"
                      disabled={!status.encryptionConfigured}
                      value={drafts[name] ?? ""}
                      onChange={(e) => setDrafts((p) => ({ ...p, [name]: e.target.value }))}
                      placeholder={s.source === "db" ? "replace…" : "set…"}
                      className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs outline-none focus:border-foreground/40 disabled:opacity-50"
                    />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      onClick={() => save(name, drafts[name] ?? "")}
                      disabled={!status.encryptionConfigured || busy === name || !(drafts[name] ?? "").trim()}
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-card disabled:opacity-40"
                    >
                      {busy === name ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                    </button>
                    {s.source === "db" && (
                      <button
                        onClick={() => {
                          if (confirm(`Clear ${name} from the database? The environment variable resumes, if one is set.`)) save(name, "")
                        }}
                        disabled={busy === name}
                        className="ml-2 rounded-md border border-[var(--danger)]/40 px-2.5 py-1 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/5 disabled:opacity-40"
                      >
                        Clear
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        A database value takes precedence over the environment variable of the same name.
        Clearing one restores the env fallback. Core secrets (service role, cron, blob,
        database URL) are deliberately absent and remain environment-only.
      </p>
    </div>
  )
}
