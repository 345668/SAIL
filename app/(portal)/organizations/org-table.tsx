"use client"

import { useState } from "react"
import { Eye, Loader2, ExternalLink } from "lucide-react"

export interface OrgRow {
  id: string
  name: string
  createdAt: string | null
  members: number
  personas: string[]
}

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"

export function OrgTable({ rows }: { rows: OrgRow[] }) {
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [handoff, setHandoff] = useState<{ org: string; url: string; mode: string } | null>(null)

  const filtered = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.id.includes(q))

  async function viewAs(org: OrgRow, mode: "readonly" | "full") {
    setBusy(org.id)
    try {
      const res = await fetch("/api/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: org.id, mode }),
      })
      const d = await res.json()
      if (d.url) setHandoff({ org: org.name, url: d.url, mode })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search organizations…"
        className="mb-4 w-full sm:w-80 h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-[var(--accent)]"
      />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5">Organization</th>
              <th className="text-left px-4 py-2.5">Personas</th>
              <th className="text-right px-4 py-2.5">Members</th>
              <th className="text-left px-4 py-2.5">Created</th>
              <th className="text-right px-4 py-2.5">View as</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No organizations.</td></tr>
            ) : filtered.map((r) => (
              <tr key={r.id} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{r.name}</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{r.id}</div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {r.personas.length === 0 ? <span className="text-muted-foreground">—</span> :
                      r.personas.map((p) => (
                        <span key={p} className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px]">{p}</span>
                      ))}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.members}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(r.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1.5">
                    <button
                      onClick={() => viewAs(r, "readonly")}
                      disabled={busy === r.id}
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-xs hover:border-[var(--accent)] disabled:opacity-50"
                    >
                      {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                      Read-only
                    </button>
                    <button
                      onClick={() => viewAs(r, "full")}
                      disabled={busy === r.id}
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs text-white disabled:opacity-50"
                      style={{ background: "var(--accent)" }}
                    >
                      Full
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {handoff && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setHandoff(null)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-lg">Open Venture OS as “{handoff.org}”</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              A single-use, 5-minute impersonation grant was minted ({handoff.mode}). Opening the
              link starts an impersonated session in the tenant app with a persistent banner.
            </p>
            <a
              href={handoff.url}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-md text-sm text-white"
              style={{ background: "var(--accent)" }}
            >
              <ExternalLink className="w-4 h-4" /> Open impersonated session
            </a>
            <p className="mt-3 font-mono text-[10px] text-muted-foreground break-all">{handoff.url}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Tenant-side acceptance (<code>/api/impersonate/accept</code>) lands in the next phase; the
              grant is already recorded and audited.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
