import { sql } from "./db"
import { decryptSecret } from "./crypto"
import { verifyTotp } from "./totp"
import { audit } from "./audit"
import { checkLock, recordAttempt } from "./login-guard"

/**
 * A fresh two-factor code for a dangerous action (offboarding, erasure). Authenticator codes only, never recovery codes, and a code that was already
 * used (at sign-in or for a previous action) is refused, so a step-up always needs the NEXT code from the authenticator.
 * Failures count toward the same lockout as sign-in.
 */
export class StepUpError extends Error { constructor(message: string, readonly status = 401) { super(message) } }

export async function requireStepUp(staff: { id: string; email: string }, code: string, ip = "0.0.0.0", action = "action"): Promise<void> {
  if ((await checkLock(staff.email, ip)).locked) throw new StepUpError("Too many attempts. Try again later.", 429)
  const m = ((await sql`SELECT secret_enc, last_used_step FROM staff_mfa WHERE staff_id = ${staff.id} AND enabled_at IS NOT NULL`) as any[])[0]
  if (!m) throw new StepUpError("Two-factor is not set up for your account.", 409)
  const step = verifyTotp(decryptSecret(m.secret_enc), String(code ?? ""), { lastUsedStep: m.last_used_step == null ? null : Number(m.last_used_step) })
  const won = step === null ? [] : ((await sql`UPDATE staff_mfa SET last_used_step = ${step} WHERE staff_id = ${staff.id} AND (last_used_step IS NULL OR last_used_step < ${step}) RETURNING staff_id`) as any[])
  if (!won.length) {
    await recordAttempt(staff.email, ip, false, "mfa")
    await audit("auth.stepup_failed", staff, null, { ip, action })
    throw new StepUpError("That code is not right, or it was already used. Wait for the next code and try again.")
  }
  await recordAttempt(staff.email, ip, true, "mfa")
  await audit("auth.stepup", staff, null, { ip, action })
}
