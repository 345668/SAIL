import { NextResponse } from "next/server"
import { createHash, randomInt } from "crypto"
import { getPartialSession, markMfaVerified } from "@/lib/auth"
import { sql } from "@/lib/db"
import { decryptSecret } from "@/lib/crypto"
import { verifyTotp } from "@/lib/totp"
import { audit } from "@/lib/audit"
import { checkLock, clientIp, recordAttempt } from "@/lib/login-guard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const hash = (c: string) => createHash("sha256").update(c.replace(/[\s-]/g, "").toUpperCase()).digest("hex")
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const newBackupCode = () => Array.from({ length: 10 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("").replace(/(.{5})(.{5})/, "$1-$2")

/** Confirm enrolment with a code from the authenticator, activate it, and hand over ten one-time recovery codes (shown once). */
export async function POST(req: Request) {
  const s = await getPartialSession()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (s.mfaEnabled) return NextResponse.json({ error: "Two-factor is already enabled." }, { status: 409 })
  const ip = clientIp(req)
  if ((await checkLock(s.email, ip)).locked) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })

  const { code } = await req.json().catch(() => ({ code: "" }))
  const rows = (await sql`SELECT secret_enc FROM staff_mfa WHERE staff_id = ${s.id} AND enabled_at IS NULL`) as any[]
  if (!rows[0]) return NextResponse.json({ error: "Start setup first." }, { status: 400 })
  const step = verifyTotp(decryptSecret(rows[0].secret_enc), String(code ?? ""))
  if (step === null) {
    await recordAttempt(s.email, ip, false, "mfa")
    await audit("auth.mfa_enable_failed", s, null, { ip })
    return NextResponse.json({ error: "That code is not right. Check the time on your phone and try the next code." }, { status: 401 })
  }
  const backup = Array.from({ length: 10 }, newBackupCode)
  await sql`UPDATE staff_mfa SET enabled_at = now(), backup_hashes = ${backup.map(hash)}, last_used_step = ${step} WHERE staff_id = ${s.id}`
  await markMfaVerified(s.sid)
  await recordAttempt(s.email, ip, true, "mfa")
  await audit("auth.mfa_enabled", s, null, { ip })
  await audit("auth.login", s, null, { ip, method: "password+totp(enrol)" })
  return NextResponse.json({ ok: true, backupCodes: backup }, { headers: { "Cache-Control": "no-store" } })
}
