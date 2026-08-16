import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { readNewsKeys, saveNewsKeys, NEWS_KEY_NAMES, type NewsKeyName } from "@/lib/news/runtime-keys"
import { sql } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface KeyStatus { name: NewsKeyName; set: boolean; source: "db" | "env" | "none"; masked: string | null }

function statusOf(saved: Record<string, string | undefined>): KeyStatus[] {
  return NEWS_KEY_NAMES.map((name) => {
    const fromDb = saved[name]
    const fromEnv = process.env[name]?.trim()
    if (fromDb) return { name, set: true, source: "db", masked: maskTail(fromDb) }
    if (fromEnv) return { name, set: true, source: "env", masked: null }
    return { name, set: false, source: "none", masked: null }
  })
}

export async function GET() {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const dbKeys = await readNewsKeys()
  return NextResponse.json({ keys: statusOf(dbKeys) })
}

export async function POST(req: Request) {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  try {
    const body = await req.json()
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body must be a JSON object of name→value" }, { status: 400 })
    }
    const updates: Partial<Record<NewsKeyName, string>> = {}
    for (const name of NEWS_KEY_NAMES) {
      if (name in body) {
        const v = (body as any)[name]
        if (v == null) updates[name] = ""
        else if (typeof v === "string") updates[name] = v
      }
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to update — pass one or more recognised key names." }, { status: 400 })
    }
    const saved = await saveNewsKeys(updates, staff.id)
    try {
      await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail)
        VALUES (${staff.id}, ${staff.email}, 'news_keys.update', ${Object.keys(updates).join(",")}, NULL)`
    } catch { /* audit best-effort */ }
    return NextResponse.json({ keys: statusOf(saved) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Save failed" }, { status: 500 })
  }
}

function maskTail(s: string): string {
  const tail = s.slice(-4)
  return tail.length > 0 ? `••••${tail}` : "•••"
}
