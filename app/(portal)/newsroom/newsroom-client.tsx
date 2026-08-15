"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Loader2, Send, Archive, Trash2, Undo2, Pencil } from "lucide-react"
import { ARTICLE_BLOG_TYPES, type NewsArticle } from "@/lib/newsroom"

const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—")

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "var(--muted-foreground)" },
  published: { label: "Published", color: "var(--ok)" },
  archived: { label: "Archived", color: "var(--muted-foreground)" },
}
const SENTIMENT_STYLE: Record<string, { label: string; color: string }> = {
  bullish: { label: "Bullish", color: "var(--ok)" },
  neutral: { label: "Neutral", color: "var(--muted-foreground)" },
  bearish: { label: "Bearish", color: "var(--danger)" },
}

export function NewsroomClient({ initial }: { initial: NewsArticle[] }) {
  const [articles, setArticles] = useState(initial)
  const [tab, setTab] = useState<"all" | "draft" | "published" | "archived">("all")
  const [type, setType] = useState<string>("all")
  const [q, setQ] = useState("")
  const [rowBusy, setRowBusy] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c = { all: articles.length, draft: 0, published: 0, archived: 0 }
    for (const a of articles) c[a.status]++
    return c
  }, [articles])

  const visible = articles.filter((a) => {
    if (tab !== "all" && a.status !== tab) return false
    if (type !== "all" && a.blog_type !== type) return false
    if (q) {
      const hay = `${a.headline} ${a.subheadline ?? ""} ${a.tags.join(" ")}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })

  async function setStatus(row: NewsArticle, status: NewsArticle["status"]) {
    setRowBusy(row.id)
    try {
      const res = await fetch(`/api/newsroom/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const d = await res.json()
      if (d.article) setArticles((a) => a.map((x) => (x.id === row.id ? d.article : x)))
    } finally {
      setRowBusy(null)
    }
  }

  async function remove(row: NewsArticle) {
    if (!confirm(`Delete “${row.headline}”? This cannot be undone.`)) return
    setRowBusy(row.id)
    try {
      const res = await fetch(`/api/newsroom/${row.id}`, { method: "DELETE" })
      if (res.ok) setArticles((a) => a.filter((x) => x.id !== row.id))
    } finally {
      setRowBusy(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-1">
          {(["all", "draft", "published", "archived"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`h-8 px-3 rounded-md text-xs capitalize transition-colors ${
                tab === t ? "bg-[var(--accent-soft)] text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t} <span className="tabular-nums opacity-60">{counts[t]}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-[var(--accent)]"
        >
          <option value="all">All types</option>
          {ARTICLE_BLOG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search headline, tags…"
          className="h-8 w-56 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="overflow-x-auto card-elev rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5">Article</th>
              <th className="text-left px-4 py-2.5">Type</th>
              <th className="text-left px-4 py-2.5">Sentiment</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Published</th>
              <th className="text-right px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No articles here.</td></tr>
            ) : visible.map((a) => {
              const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.draft
              const se = a.sentiment ? SENTIMENT_STYLE[a.sentiment] : null
              return (
                <tr key={a.id} className="border-b border-border/60 last:border-0 align-top">
                  <td className="px-4 py-3">
                    <Link href={`/newsroom/${a.id}`} className="font-medium hover:text-[var(--accent)]">{a.headline}</Link>
                    {a.subheadline && <div className="text-muted-foreground text-xs mt-0.5 max-w-md truncate">{a.subheadline}</div>}
                    {a.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {a.tags.slice(0, 5).map((t) => (
                          <span key={t} className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10px]">{t}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3"><span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px]">{a.blog_type}</span></td>
                  <td className="px-4 py-3">{se ? <span className="text-[11px]" style={{ color: se.color }}>{se.label}</span> : <span className="text-muted-foreground text-xs">—</span>}</td>
                  <td className="px-4 py-3"><span className="text-[11px]" style={{ color: st.color }}>{st.label}</span></td>
                  <td className="px-4 py-3 text-muted-foreground">{fmt(a.published_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Link href={`/newsroom/${a.id}`} title="Edit"
                        className="inline-flex items-center h-8 px-2 rounded-md border border-border text-xs hover:border-[var(--accent)]">
                        <Pencil className="w-3.5 h-3.5" />
                      </Link>
                      {a.status !== "published" ? (
                        <button onClick={() => setStatus(a, "published")} disabled={rowBusy === a.id} title="Publish"
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs disabled:opacity-50"
                          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
                          {rowBusy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Publish
                        </button>
                      ) : (
                        <button onClick={() => setStatus(a, "draft")} disabled={rowBusy === a.id} title="Unpublish → draft"
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs hover:border-[var(--accent)] disabled:opacity-50">
                          <Undo2 className="w-3.5 h-3.5" /> Unpublish
                        </button>
                      )}
                      {a.status !== "archived" ? (
                        <button onClick={() => setStatus(a, "archived")} disabled={rowBusy === a.id} title="Archive"
                          className="inline-flex items-center h-8 px-2 rounded-md border border-border text-xs hover:border-[var(--accent)] disabled:opacity-50">
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => setStatus(a, "draft")} disabled={rowBusy === a.id} title="Restore to draft"
                          className="inline-flex items-center h-8 px-2 rounded-md border border-border text-xs hover:border-[var(--accent)] disabled:opacity-50">
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => remove(a)} disabled={rowBusy === a.id} title="Delete"
                        className="inline-flex items-center h-8 px-2 rounded-md border border-border text-xs hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:opacity-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
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
