import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { decryptSecret } from "@/lib/crypto"
import { gatherSources } from "@/lib/news/ingest"
import { loadNewsroomSkill } from "@/lib/newsroom-skill"
import { mistralProblem } from "@/lib/mistral-errors"
import { polishArticle } from "@/lib/newsroom-style"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

/**
 * AI first-draft for a newsroom article, "Anker AI", powered by the portal's
 * OWN stored Mistral platform key (platform_api_keys, decrypted server-side;
 * MISTRAL_API_KEY in the environment is the fallback). No tenant AI router
 * involved. The voice and house rules come from skills/newsroom-writer.md, and
 * every draft is cleaned of dashes and checked for banned phrases afterwards
 * (lib/newsroom-style.ts), so the mechanical rules hold whatever the model does.
 *
 * Grounding: when source items are supplied, or auto-retrieved from the topic
 * and an editorial theme's keywords, their headlines and summaries are injected
 * as a SOURCES block. The model builds the piece on those facts and closes with
 * a "## Sources" section; the structured sources come back too, so the editor
 * can persist news_articles.sources and source_item_ids on save.
 *
 * Body: { topic, blogType?, lengthHint?: short|medium|long|feature, voice?,
 *         audienceHint?, themeId?, sourceItemIds?: string[], groundFromNews? }
 * Returns: { headline, subheadline, content, suggestedTags, sentiment,
 *            sources, usedSourceItemIds }
 */
const LENGTHS: Record<string, { words: number; structure: string }> = {
  short:  { words: 500,  structure: "A tight brief: hook, 2-3 H2 sections, close." },
  medium: { words: 1000, structure: "A standard piece: hook, 4-5 H2 sections, close." },
  long:   { words: 1800, structure: "A long-read: hook, 5-7 H2 sections with H3s where useful, one worked example, close." },
  feature:{ words: 3000, structure: "A feature essay: scene-set, thesis, 6-9 H2 sections (context→evidence→implications), two case studies, a counter-argument, strong close. No padding." },
}

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions"
/** The newsroom model. Override with NEWSROOM_MISTRAL_MODEL; the "latest" alias follows Mistral's current large model. */
const MODEL = () => process.env.NEWSROOM_MISTRAL_MODEL || "mistral-large-latest"

async function mistralKey(): Promise<string | null> {
  const rows = await sql`
    SELECT secret_cipher FROM platform_api_keys
    WHERE provider = 'mistral' AND NOT disabled
    ORDER BY created_at DESC LIMIT 1`
  const cipher = (rows[0] as any)?.secret_cipher
  if (cipher) {
    try {
      return decryptSecret(cipher)
    } catch {
      /* fall through to the environment */
    }
  }
  return process.env.MISTRAL_API_KEY?.trim() || null
}

export async function POST(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let b: any
  try {
    b = await req.json()
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }
  const topic = String(b.topic || "").trim()
  if (!topic) return NextResponse.json({ error: "topic required" }, { status: 400 })

  const blogType = String(b.blogType || "Insights")
  const lengthKey = LENGTHS[String(b.lengthHint || "medium")] ? String(b.lengthHint || "medium") : "medium"
  const { words, structure } = LENGTHS[lengthKey]
  const voice = String(b.voice || "concise, founder-friendly, evidence-led")
  const audience = String(b.audienceHint || "founders raising and LPs evaluating funds")

  let themeLine = ""
  let themeKeywords: string[] = []
  if (b.themeId) {
    try {
      const rows = await sql`SELECT name, description, keywords FROM news_themes WHERE id = ${String(b.themeId)}::uuid AND enabled LIMIT 1`
      const t = rows[0] as any
      if (t) {
        themeKeywords = Array.isArray(t.keywords) ? t.keywords.map(String) : []
        const kw = themeKeywords.join(", ")
        themeLine = `\nEditorial theme: ${t.name}${t.description ? ` — ${t.description}` : ""}${kw ? `\nGround the angle in these keywords: ${kw}.` : ""}`
      }
    } catch {
      /* theme optional */
    }
  }

  // Grounding. Either the editor picked specific stories, or we retrieve
  // recent ones matching the topic and theme. Without this the model writes
  // from its own priors and the article cites nothing — which is what the
  // portal has been doing, because this half was never ported across.
  const grounding = await gatherSources({
    topic,
    themeKeywords,
    sourceItemIds: Array.isArray(b.sourceItemIds) ? b.sourceItemIds.map(String).slice(0, 12) : [],
    auto: b.groundFromNews === true || !!b.themeId,
  })
  const sourcesBlock = grounding.length
    ? `\n\nSOURCES — ground the article in these reported items. Use their concrete facts, figures and names, attribute claims to them, and do not invent beyond them. Close with a "## Sources" section listing each source you used as a Markdown link.\n` +
      grounding.map((s, i) =>
        `[S${i + 1}] ${s.headline}${s.published_at ? ` (${String(s.published_at).slice(0, 10)})` : ""}` +
        `${s.source_url ? ` — ${s.source_url}` : ""}\n${(s.summary || s.content || "").replace(/\s+/g, " ").slice(0, 600)}`,
      ).join("\n\n")
    : ""

  const key = await mistralKey()
  if (!key) {
    return NextResponse.json(
      { error: "No active Mistral platform key. Add one under Platform API keys (provider: mistral), then retry." },
      { status: 412 },
    )
  }
  const skill = await loadNewsroomSkill()

  const system = `${skill.body}

# This piece
Type: ${blogType}. Audience: ${audience}. Voice note from the editor: ${voice}. Target about ${words} words. Structure: ${structure}`
  const user = `Draft a newsroom article on: ${topic}.${themeLine}${sourcesBlock}

Return ONLY valid minified JSON (no code fence) with exactly these keys:
{"headline": string, "subheadline": string, "content": string (Markdown body), "suggestedTags": string[] (3-6 lowercase tags), "sentiment": "bullish"|"neutral"|"bearish"}`

  try {
    const res = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${key}`,
        // A named client: some edge filters answer 403 to anonymous server requests.
        "user-agent": "Anker-SAIL/1.0 (+https://an-ker.de)",
      },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: skill.maxTokens,
        temperature: skill.temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => "")
      console.error("[newsroom] Mistral refused the draft:", res.status, detail.slice(0, 300))
      return NextResponse.json({ error: mistralProblem(res.status, detail), detail: detail.slice(0, 400) }, { status: 502 })
    }
    const data = await res.json()
    const text: string = String(data?.choices?.[0]?.message?.content ?? "").trim()
    const jsonStr = text.startsWith("{") ? text : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
    let parsed: any
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      // Fall back to raw markdown body if the model didn't return clean JSON.
      parsed = { headline: topic, subheadline: "", content: text, suggestedTags: [], sentiment: "neutral" }
    }

    const tags = Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags.filter((t: any) => typeof t === "string").slice(0, 8) : []
    // House style: dashes out, banned phrases and an over-long headline reported for the editor.
    const { article, report, headlineTooLong } = polishArticle({
      headline: String(parsed.headline || topic),
      subheadline: String(parsed.subheadline || ""),
      content: String(parsed.content || ""),
      suggestedTags: tags,
    })

    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'newsroom.ai_draft', ${blogType}, ${JSON.stringify({ topic, lengthKey, model: MODEL(), skill: skill.fromFile ? "newsroom-writer" : "fallback" }).slice(0, 500)}::jsonb)`

    return NextResponse.json({
      headline: article.headline,
      subheadline: article.subheadline,
      content: article.content,
      suggestedTags: article.suggestedTags,
      sentiment: ["bullish", "neutral", "bearish"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
      // What the style pass did and what is left for a human to judge.
      style: { ...report, headlineTooLong },
      // Returned structurally as well as inside the prose, so the editor can
      // persist provenance on the article instead of the link list being the
      // only record of what the piece was built from.
      sources: grounding.map(s => ({ headline: s.headline, url: s.source_url, publishedAt: s.published_at })),
      usedSourceItemIds: grounding.map(s => s.id),
    })
  } catch (e: any) {
    const msg = e?.name === "TimeoutError" ? "Mistral timed out" : e?.message || "draft failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
