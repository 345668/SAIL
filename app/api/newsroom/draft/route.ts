import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { decryptSecret } from "@/lib/crypto"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 300

/**
 * AI first-draft for a newsroom article — "Anker AI", powered by the portal's
 * OWN stored Anthropic platform key (platform_api_keys, decrypted server-side).
 * No tenant AI router involved. Optionally grounds the angle in an editorial
 * theme's keywords.
 *
 * Body: { topic, blogType?, lengthHint?: short|medium|long|feature, voice?,
 *         audienceHint?, themeId? }
 * Returns: { headline, subheadline, content, suggestedTags, sentiment }
 */
const LENGTHS: Record<string, { words: number; structure: string }> = {
  short:  { words: 500,  structure: "A tight brief: hook, 2-3 H2 sections, close." },
  medium: { words: 1000, structure: "A standard piece: hook, 4-5 H2 sections, close." },
  long:   { words: 1800, structure: "A long-read: hook, 5-7 H2 sections with H3s where useful, one worked example, close." },
  feature:{ words: 3000, structure: "A feature essay: scene-set, thesis, 6-9 H2 sections (context→evidence→implications), two case studies, a counter-argument, strong close. No padding." },
}

async function anthropicKey(): Promise<string | null> {
  const rows = await sql`
    SELECT secret_cipher FROM platform_api_keys
    WHERE provider = 'anthropic' AND NOT disabled
    ORDER BY created_at DESC LIMIT 1`
  const cipher = (rows[0] as any)?.secret_cipher
  if (!cipher) return null
  try {
    return decryptSecret(cipher)
  } catch {
    return null
  }
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
  if (b.themeId) {
    try {
      const rows = await sql`SELECT name, description, keywords FROM news_themes WHERE id = ${String(b.themeId)}::uuid AND enabled LIMIT 1`
      const t = rows[0] as any
      if (t) {
        const kw = Array.isArray(t.keywords) ? t.keywords.join(", ") : ""
        themeLine = `\nEditorial theme: ${t.name}${t.description ? ` — ${t.description}` : ""}${kw ? `\nGround the angle in these keywords: ${kw}.` : ""}`
      }
    } catch {
      /* theme optional */
    }
  }

  const key = await anthropicKey()
  if (!key) {
    return NextResponse.json(
      { error: "No active Anthropic platform key. Add one under Platform API keys, then retry." },
      { status: 412 },
    )
  }

  const system = `You are the editor of Anker's public newsroom. You write ${blogType} pieces for ${audience}. Voice: ${voice}. Target ~${words} words. Structure: ${structure} Use Markdown with H2 (##) section headers. Do not invent specific statistics or quotes; keep claims defensible.`
  const user = `Draft a newsroom article on: ${topic}.${themeLine}

Return ONLY valid minified JSON (no code fence) with exactly these keys:
{"headline": string, "subheadline": string, "content": string (Markdown body), "suggestedTags": string[] (3-6 lowercase tags), "sentiment": "bullish"|"neutral"|"bearish"}`

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => "")
      return NextResponse.json({ error: `Anthropic ${res.status}`, detail: detail.slice(0, 400) }, { status: 502 })
    }
    const data = await res.json()
    const text: string = (data?.content || []).map((c: any) => c?.text || "").join("").trim()
    const jsonStr = text.startsWith("{") ? text : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
    let parsed: any
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      // Fall back to raw markdown body if the model didn't return clean JSON.
      parsed = { headline: topic, subheadline: "", content: text, suggestedTags: [], sentiment: "neutral" }
    }

    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
      VALUES (${staff.id}, ${staff.email}, 'newsroom.ai_draft', ${blogType}, ${JSON.stringify({ topic, lengthKey }).slice(0, 500)}::jsonb)`

    return NextResponse.json({
      headline: String(parsed.headline || topic),
      subheadline: String(parsed.subheadline || ""),
      content: String(parsed.content || ""),
      suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags.filter((s: any) => typeof s === "string").slice(0, 8) : [],
      sentiment: ["bullish", "neutral", "bearish"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
    })
  } catch (e: any) {
    const msg = e?.name === "TimeoutError" ? "Anthropic timed out" : e?.message || "draft failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
