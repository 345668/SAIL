"use client"

import { useMemo, useState } from "react"
import { Plus, Loader2, Send, Archive, Trash2, Undo2, PenLine } from "lucide-react"

export interface Article {
  id: string
  headline: string
  subheadline: string | null
  author: string
  blog_type: string
  status: "draft" | "published" | "archived"
  image_url: string | null
  slug: string | null
  published_at: string | null
  created_at: string
  updated_at: string | null
}

const BLOG_TYPES = ["Insights", "Trends", "Analysis", "Guides", "News", "Press", "Investment", "Announcements"]
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—")

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "var(--muted-foreground)" },
  published: { label: "Published", color: "var(--ok)" },
  archived: { label: "Archived", color: "var(--muted-foreground)" },
}

export function NewsroomClient({ initial }: { initial: Article[] }) {
  const [articles, setArticles] = useState(initial)
  const [tab, setTab] = useState<"all" | "draft" | "published" | "archived">("all")
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [rowBusy, setRowBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ headline: "", subheadline: "", blog_type: "Insights", author: "Anker", content: "" })

  const counts = useMemo(() => {
    const c = { all: articles.length, draft: 0, published: 0, archived: 0 }
    for (const a of articles) c[a.status]++
    return c
  }, [articles])

  const visible = tab === "all" ? articles : articles.filter((a) => a.status === tab)

  async function create() {
    if (!f.headline.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch("/api/newsroom", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(f),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "create failed")
      setArticles((a) => [d.article, ...a])
      setF({ headline: "", subheadline: "", blog_type: "Insights", author: "Anker", content: "" })
      setOpen(false)
    } catch (e: any) {
      setErr(e?.message || "create failed")
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(row: Article, status: Article["status"]) {
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

  async function remove(row: Article) {
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
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex gap-1">
          {(["all", "draft", "published", "archived"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`h-8 px-3 rounded-md text-xs capitalize transition-colors ${
                tab === t ? "bg-[var(--accent)]/15 text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t} <span className="tabular-nums opacity-60">{counts[t]}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm text-[var(--primary-foreground)]"
          style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <Plus className="w-4 h-4" /> New article
        </button>
      </div>

      {open && (
        <div className="mb-6 card-elev rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><PenLine className="w-4 h-4" /> New article</h3>
          <div className="grid gap-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Headline</span>
                <input value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} placeholder="Anker raises…"
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-[var(--accent)]" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Subheadline</span>
                <input value={f.subheadline} onChange={(e) => setF({ ...f, subheadline: e.target.value })}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-[var(--accent)]" />
              </label>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Type</span>
                <select value={f.blog_type} onChange={(e) => setF({ ...f, blog_type: e.target.value })}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-[var(--accent)]">
                  {BLOG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Author</span>
                <input value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })}
                  className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-[var(--accent)]" />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Body (Markdown)</span>
              <textarea value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} rows={6}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[var(--accent)] resize-y" />
            </label>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={create} disabled={busy || !f.headline.trim()}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-md text-sm text-[var(--primary-foreground)] disabled:opacity-50" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Save draft
            </button>
            <button onClick={() => setOpen(false)} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            {err && <span className="text-sm text-[var(--danger)]">{err}</span>}
          </div>
        </div>
      )}

      <div className="overflow-x-auto card-elev rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5">Article</th>
              <th className="text-left px-4 py-2.5">Type</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Published</th>
              <th className="text-right px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No articles here.</td></tr>
            ) : visible.map((a) => {
              const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.draft
              return (
                <tr key={a.id} className="border-b border-border/60 last:border-0 align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.headline}</div>
                    {a.subheadline && <div className="text-muted-foreground text-xs mt-0.5 max-w-md truncate">{a.subheadline}</div>}
                    <div className="font-mono text-[10px] text-muted-foreground mt-1">{a.author} · {a.slug ?? a.id}</div>
                  </td>
                  <td className="px-4 py-3"><span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[11px]">{a.blog_type}</span></td>
                  <td className="px-4 py-3"><span className="text-[11px]" style={{ color: st.color }}>{st.label}</span></td>
                  <td className="px-4 py-3 text-muted-foreground">{fmt(a.published_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      {a.status !== "published" && (
                        <button onClick={() => setStatus(a, "published")} disabled={rowBusy === a.id} title="Publish"
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs text-[var(--primary-foreground)] disabled:opacity-50" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
                          {rowBusy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Publish
                        </button>
                      )}
                      {a.status === "published" && (
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
