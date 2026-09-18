"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Loader2, Sparkles, Save, Send, Trash2, ArrowLeft, Check, ImageUp } from "lucide-react"
import { ARTICLE_BLOG_TYPES, ARTICLE_SENTIMENTS, type NewsArticle } from "@/lib/newsroom"

interface Theme { id: string; name: string; keywords: string[]; enabled: boolean }

const LENGTHS = [
  { id: "short", label: "Short · ~500w" },
  { id: "medium", label: "Medium · ~1000w" },
  { id: "long", label: "Long · ~1800w" },
  { id: "feature", label: "Feature · ~3000w" },
]

const empty = {
  headline: "", subheadline: "", blog_type: "Insights", author: "Anker",
  tags: "", sentiment: "", scheduled_for: "", source_pdf_url: "", image_url: "", content: "",
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function NewsroomEditor({ article }: { article?: NewsArticle }) {
  const router = useRouter()
  const params = useSearchParams()
  const editing = !!article
  const [f, setF] = useState(
    article
      ? {
          headline: article.headline,
          subheadline: article.subheadline ?? "",
          blog_type: article.blog_type,
          author: article.author,
          tags: article.tags.join(", "),
          sentiment: article.sentiment ?? "",
          scheduled_for: toLocalInput(article.scheduled_for),
          source_pdf_url: article.source_pdf_url ?? "",
          image_url: article.image_url ?? "",
          content: article.content ?? "",
        }
      : { ...empty },
  )
  const [status, setStatus] = useState<NewsArticle["status"]>(article?.status ?? "draft")
  const [themes, setThemes] = useState<Theme[]>([])
  const [ai, setAi] = useState({ topic: "", length: "medium", themeId: "", ground: true })
  const [drafting, setDrafting] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Which reported stories this piece was built on. Carried from the grounded
  // draft and saved with the article, so the provenance survives the draft.
  const [provenance, setProvenance] = useState<{ sources: any[]; sourceItemIds: string[] }>({ sources: [], sourceItemIds: [] })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/newsroom/themes").then((r) => r.json()).then((d) => {
      if (Array.isArray(d.themes)) setThemes(d.themes.filter((t: Theme) => t.enabled))
    }).catch(() => {})
  }, [])

  // Pick up a "draft from source" seed handed over from News sources.
  useEffect(() => {
    if (editing || params.get("from-source") !== "1") return
    try {
      const raw = sessionStorage.getItem("newsroom:draft-from-source")
      if (!raw) return
      sessionStorage.removeItem("newsroom:draft-from-source")
      const s = JSON.parse(raw)
      setF((c) => ({
        ...c,
        headline: s.headline || c.headline,
        subheadline: s.subheadline || c.subheadline,
        content: s.content || c.content,
        tags: Array.isArray(s.suggestedTags) && s.suggestedTags.length ? s.suggestedTags.join(", ") : c.tags,
        sentiment: s.sentiment || c.sentiment,
        image_url: s.imageUrl || c.image_url,
        source_pdf_url: s.sourceUrl || c.source_pdf_url,
        blog_type: "Analysis",
      }))
      if (Array.isArray(s.sources) || Array.isArray(s.sourceItemIds)) {
        setProvenance({
          sources: Array.isArray(s.sources) ? s.sources : [],
          sourceItemIds: Array.isArray(s.sourceItemIds) ? s.sourceItemIds : [],
        })
      }
    } catch { /* ignore malformed seed */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (patch: Partial<typeof f>) => { setF((c) => ({ ...c, ...patch })); setSaved(false) }

  function payload(overrideStatus?: NewsArticle["status"]) {
    return {
      headline: f.headline,
      subheadline: f.subheadline || null,
      content: f.content || null,
      author: f.author || "Anker",
      blog_type: f.blog_type,
      tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
      sentiment: f.sentiment || null,
      scheduled_for: f.scheduled_for ? new Date(f.scheduled_for).toISOString() : null,
      source_pdf_url: f.source_pdf_url || null,
      image_url: f.image_url || null,
      status: overrideStatus ?? status,
      sources: provenance.sources,
      source_item_ids: provenance.sourceItemIds,
    }
  }

  async function aiDraft() {
    if (!ai.topic.trim()) return
    setDrafting(true)
    setErr(null)
    try {
      const res = await fetch("/api/newsroom/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // groundFromNews retrieves recent stored stories matching the topic
        // and the theme, so a draft from here is built on reported facts
        // rather than the model's priors.
        body: JSON.stringify({ topic: ai.topic, lengthHint: ai.length, themeId: ai.themeId || undefined, blogType: f.blog_type, groundFromNews: ai.ground }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "draft failed")
      set({
        headline: d.headline || f.headline,
        subheadline: d.subheadline || f.subheadline,
        content: d.content || f.content,
        tags: Array.isArray(d.suggestedTags) && d.suggestedTags.length ? d.suggestedTags.join(", ") : f.tags,
        sentiment: d.sentiment || f.sentiment,
      })
      setProvenance({
        sources: Array.isArray(d.sources) ? d.sources : [],
        sourceItemIds: Array.isArray(d.usedSourceItemIds) ? d.usedSourceItemIds : [],
      })
    } catch (e: any) {
      setErr(e?.message || "draft failed")
    } finally {
      setDrafting(false)
    }
  }

  /**
   * Upload a cover image through the tenant relay.
   *
   * The bytes deliberately go to the tenant's blob store, not one of ours: the
   * public newsroom is served by the tenant app and image_url is a path into
   * that store, so an image uploaded anywhere else would 404 for readers.
   */
  async function uploadImage(file: File) {
    setUploading(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/anker/admin/newsroom/upload-image", { method: "POST", body: fd })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? `Upload failed (${res.status})`)
      set({ image_url: String(d.url) })
    } catch (e: any) {
      setErr(e?.message ?? "Image upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function save(overrideStatus?: NewsArticle["status"]) {
    if (!f.headline.trim()) { setErr("Headline is required"); return }
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(editing ? `/api/newsroom/${article!.id}` : "/api/newsroom", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload(overrideStatus)),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || "save failed")
      if (overrideStatus) setStatus(overrideStatus)
      setSaved(true)
      if (!editing && d.article?.id) router.push(`/newsroom/${d.article.id}`)
      else router.refresh()
    } catch (e: any) {
      setErr(e?.message || "save failed")
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!editing) return
    if (!confirm(`Delete “${article!.headline}”? This cannot be undone.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/newsroom/${article!.id}`, { method: "DELETE" })
      if (res.ok) router.push("/newsroom")
    } finally {
      setBusy(false)
    }
  }

  const field = "h-9 w-full rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-[var(--accent)]"
  const label = "text-[11px] font-mono uppercase tracking-wider text-muted-foreground"

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-8">
      {/* Main column */}
      <div className="space-y-5 min-w-0">
        <Link href="/newsroom" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> All articles
        </Link>

        <label className="block space-y-1.5">
          <span className={label}>Headline</span>
          <input value={f.headline} onChange={(e) => set({ headline: e.target.value })} placeholder="Anker raises…"
            className="h-11 w-full rounded-md border border-border bg-card px-3 text-lg font-display outline-none focus:border-[var(--accent)]" />
        </label>

        <label className="block space-y-1.5">
          <span className={label}>Subheadline</span>
          <input value={f.subheadline} onChange={(e) => set({ subheadline: e.target.value })} className={field} />
        </label>

        <label className="block space-y-1.5">
          <span className={label}>Body — Markdown</span>
          <textarea value={f.content} onChange={(e) => set({ content: e.target.value })} rows={22}
            className="w-full rounded-md border border-border bg-card px-3 py-2.5 text-sm font-mono leading-relaxed outline-none focus:border-[var(--accent)] resize-y" />
        </label>
      </div>

      {/* Sidebar */}
      <div className="space-y-5">
        {/* Save bar */}
        <div className="card-elev rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => save()} disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md text-sm disabled:opacity-50"
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {editing ? "Save" : "Create draft"}
            </button>
            {editing && (
              <button onClick={remove} disabled={busy} title="Delete"
                className="inline-flex items-center h-9 px-2.5 rounded-md border border-border text-muted-foreground hover:border-[var(--danger)] hover:text-[var(--danger)]">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          {status !== "published" ? (
            <button onClick={() => save("published")} disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md border border-border text-sm hover:border-[var(--accent)] disabled:opacity-50">
              <Send className="w-4 h-4" /> {editing ? "Save & publish" : "Create & publish"}
            </button>
          ) : (
            <button onClick={() => save("draft")} disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md border border-border text-sm hover:border-[var(--accent)] disabled:opacity-50">
              Unpublish → draft
            </button>
          )}
          <div className="flex items-center gap-2 text-xs">
            <span className={label}>Status</span>
            <span className="font-medium capitalize" style={{ color: status === "published" ? "var(--ok)" : "var(--muted-foreground)" }}>{status}</span>
            {saved && <span className="ml-auto inline-flex items-center gap-1" style={{ color: "var(--ok)" }}><Check className="w-3.5 h-3.5" /> Saved</span>}
          </div>
          {err && <p className="text-xs text-[var(--danger)]">{err}</p>}
        </div>

        {/* AI first draft */}
        <div className="card-elev rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="w-4 h-4" style={{ color: "var(--accent)" }} /> Anker AI first draft
          </div>
          <p className="text-xs text-muted-foreground">Generates headline, body, tags and sentiment using the platform’s own Anthropic key. Fills the form — nothing is saved until you do.</p>
          <label className="block space-y-1.5">
            <span className={label}>Topic</span>
            <input value={ai.topic} onChange={(e) => setAi({ ...ai, topic: e.target.value })} placeholder="e.g. the rise of GP-led secondaries" className={field} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1.5">
              <span className={label}>Length</span>
              <select value={ai.length} onChange={(e) => setAi({ ...ai, length: e.target.value })} className={field}>
                {LENGTHS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className={label}>Theme</span>
              <select value={ai.themeId} onChange={(e) => setAi({ ...ai, themeId: e.target.value })} className={field}>
                <option value="">None</option>
                {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={ai.ground} onChange={(e) => setAi({ ...ai, ground: e.target.checked })}
              className="mt-0.5 size-3.5 accent-[var(--accent)]" />
            <span>Ground in fetched news — build the piece on recent stories matching the topic and theme, and record them as sources. Turn off to write from the topic alone.</span>
          </label>
          {provenance.sourceItemIds.length > 0 && (
            <p role="status" className="text-xs text-muted-foreground">
              Grounded in {provenance.sourceItemIds.length} {provenance.sourceItemIds.length === 1 ? "story" : "stories"}; saved with the article.
            </p>
          )}
          <button onClick={aiDraft} disabled={drafting || !ai.topic.trim()}
            className="w-full inline-flex items-center justify-center gap-2 h-9 px-4 rounded-md text-sm disabled:opacity-50"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>
            {drafting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {drafting ? "Drafting…" : "Draft with AI"}
          </button>
        </div>

        {/* Metadata */}
        <div className="card-elev rounded-xl border border-border p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1.5">
              <span className={label}>Type</span>
              <select value={f.blog_type} onChange={(e) => set({ blog_type: e.target.value })} className={field}>
                {ARTICLE_BLOG_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className={label}>Sentiment</span>
              <select value={f.sentiment} onChange={(e) => set({ sentiment: e.target.value })} className={field}>
                <option value="">—</option>
                {ARTICLE_SENTIMENTS.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
              </select>
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className={label}>Author</span>
            <input value={f.author} onChange={(e) => set({ author: e.target.value })} className={field} />
          </label>
          <label className="block space-y-1.5">
            <span className={label}>Tags — comma separated</span>
            <input value={f.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="vc, secondaries" className={field} />
          </label>
          <label className="block space-y-1.5">
            <span className={label}>Schedule publish</span>
            <input type="datetime-local" value={f.scheduled_for} onChange={(e) => set({ scheduled_for: e.target.value })} className={field} />
          </label>
          <div className="space-y-1.5">
            <label className="block space-y-1.5">
              <span className={label}>Cover image</span>
              <input value={f.image_url} onChange={(e) => set({ image_url: e.target.value })} placeholder="Paste a URL, or upload below" className={field} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Upload an image"}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" className="sr-only"
                disabled={uploading}
                onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) uploadImage(file) }} />
            </label>
            {f.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.image_url.startsWith("/") ? `/api/anker-image?path=${encodeURIComponent(f.image_url)}` : f.image_url}
                alt="" className="h-28 w-full rounded-md border border-border object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }} />
            )}
            <p className="text-[10px] text-muted-foreground">PNG, JPEG, WebP, AVIF or GIF, up to 5 MB. Stored by the Anker app, which is what serves it on the public article.</p>
          </div>
          <label className="block space-y-1.5">
            <span className={label}>Source PDF URL</span>
            <input value={f.source_pdf_url} onChange={(e) => set({ source_pdf_url: e.target.value })} className={field} />
          </label>
          {editing && article?.slug && (
            <div className="text-[10px] font-mono text-muted-foreground break-all pt-1">/newsroom/{article.slug}</div>
          )}
        </div>
      </div>
    </div>
  )
}
