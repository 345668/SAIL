import { NextResponse } from "next/server"
import { getPartialSession } from "@/lib/auth"
import { sql } from "@/lib/db"
import { encryptSecret } from "@/lib/crypto"
import { generateSecret, otpauthUri } from "@/lib/totp"
import { audit } from "@/lib/audit"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/** Start enrolment: a fresh secret, stored encrypted and inactive until a code from it is confirmed. Only for a session that has passed the password. */
export async function POST() {
  const s = await getPartialSession()
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (s.mfaEnabled) return NextResponse.json({ error: "Two-factor is already enabled for this account." }, { status: 409 })
  const secret = generateSecret()
  await sql`
    INSERT INTO staff_mfa (staff_id, secret_enc, enabled_at) VALUES (${s.id}, ${encryptSecret(secret)}, NULL)
    ON CONFLICT (staff_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, enabled_at = NULL, backup_hashes = '{}', last_used_step = NULL`
  await audit("auth.mfa_setup_started", s)
  return NextResponse.json({ secret, uri: otpauthUri({ email: s.email, secret }) }, { headers: { "Cache-Control": "no-store" } })
}
