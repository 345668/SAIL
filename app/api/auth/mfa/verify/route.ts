import { NextResponse } from "next/server"
import { createHash } from "crypto"
import { getPartialSession, markMfaVerified } from "@/lib/auth"
import { sql } from "@/lib/db"
import { decryptSecret } from "@/lib/crypto"
import { verifyTotp } from "@/lib/totp"
import { audit } from "@/lib/audit"
import { checkLock, clientIp, recordAttempt } from "@/lib/login-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const hash = (c: string) => createHash("sha256").update(c.replace(/[\s-]/g, "").toUpperCase()).digest("hex")

/** Step two of sign-in: a code from the authenticator, or one unused recovery code. Failures count toward the same lockout as passwords. */
export async function POST(req: Request) {
  const s = await getPartialSession()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!s.mfaEnabled) return NextResponse.json({ error: "Set up two-factor first." }, { status: 409 })
  const ip = clientIp(req)
  if ((await checkLock(s.email, ip)).locked) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })

  const { code } = await req.json().catch(() => ({ code: "" }))
  const input = String(code ?? "").trim()
  const rows = (await sql`SELECT secret_enc, backup_hashes, last_used_step FROM staff_mfa WHERE staff_id = ${s.id} AND enabled_at IS NOT NULL`) as any[]
  const m = rows[0]
  if (!m) return NextResponse.json({ error: "Set up two-factor first." }, { status: 409 })

  let method: "totp" | "backup" | null = null
  const step = verifyTotp(decryptSecret(m.secret_enc), input, { lastUsedStep: m.last_used_step == null ? null : Number(m.last_used_step) })
  if (step !== null) {
    // The step is recorded so the same code cannot be used twice; the UPDATE is conditional so two racing requests cannot both win.
    const won = (await sql`UPDATE staff_mfa SET last_used_step = ${step} WHERE staff_id = ${s.id} AND (last_used_step IS NULL OR last_used_step < ${step}) RETURNING staff_id`) as any[]
    if (won.length) method = "totp"
  } else if (/^[A-Za-z0-9-\s]{10,11}$/.test(input) && (m.backup_hashes as string[]).includes(hash(input))) {
    const used = (await sql`UPDATE staff_mfa SET backup_hashes = array_remove(backup_hashes, ${hash(input)}) WHERE staff_id = ${s.id} AND ${hash(input)} = ANY(backup_hashes) RETURNING staff_id`) as any[]
    if (used.length) method = "backup"
  }
  if (!method) {
    await recordAttempt(s.email, ip, false, "mfa")
    await audit("auth.mfa_failed", s, null, { ip })
    return NextResponse.json({ error: "That code is not right." }, { status: 401 })
  }
  await markMfaVerified(s.sid)
  await recordAttempt(s.email, ip, true, "mfa")
  await audit("auth.login", s, null, { ip, method: method === "backup" ? "password+backup-code" : "password+totp" })
  if (method === "backup") await audit("auth.backup_code_used", s, null, { remaining: (m.backup_hashes as string[]).length - 1 })
  return NextResponse.json({ ok: true, backupCodesLeft: method === "backup" ? (m.backup_hashes as string[]).length - 1 : undefined })
}
