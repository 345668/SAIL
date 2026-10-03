"use client"

import { useState } from "react"
import { Eye } from "lucide-react"

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

  const filtered = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.id.includes(q))

  return (
    <div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search organizations…"
        className="mb-4 w-full sm:w-80 h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-[var(--accent)]"
      />

      <div className="overflow-x-auto card-elev rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5">Organization</th>
              <th className="text-left px-4 py-2.5">Personas</th>
              <th className="text-right px-4 py-2.5">Members</th>
              <th className="text-left px-4 py-2.5">Created</th>
              <th className="text-right px-4 py-2.5">Inspect</th>
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
                <td className="px-4 py-2.5 text-right"><a href={`/organizations/${encodeURIComponent(r.id)}`} className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-xs hover:border-[var(--accent)]"><Eye className="w-3.5 h-3.5" /> Inspect</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  )
}
