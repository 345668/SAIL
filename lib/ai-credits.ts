import { forwardToAnker } from "./anker-proxy"
import { audit } from "./audit"
import { ControlError, MIN_REASON, roleAtLeast } from "./tenant-control"
import type { Staff } from "./studio-credits"

/**
 * Prepaid AI credit, the operator side (Anker docs/architecture/58 section 8). Dollars, beside the plan's monthly allowance: spend beyond the allowance is covered from credit. SAIL reads the
 * ledger and grants or adjusts through Anker's own route; nothing about what the credit was spent on exists here. Every change needs a reason and is audited. A grant above the admin ceiling needs a superadmin.
 */
export const ADMIN_GRANT_CEILING_USD = 500
export const MAX_GRANT_USD = 100_000
export interface LedgerRow { id: number; kind: "grant" | "debit" | "expiry" | "adjust"; amountUsd: number; grantId: number | null; source: string | null; expiresAt: string | null; period: string | null; reason: string | null; createdBy: string | null; createdAt: string }
export interface CreditView { workspace: { id: string; name: string }; balanceUsd: number; debitedThisMonthUsd: number; limitUsd: number | null; spentThisMonthUsd: number; ledger: LedgerRow[] }

async function call(staff: Staff, method: "GET" | "POST", body?: unknown, search?: string): Promise<any> {
  const res = await forwardToAnker({ path: "admin/credits", method, search, body: body ? JSON.stringify(body) : undefined, contentType: body ? "application/json" : null, staffEmail: staff.email } as any)
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status >= 500 ? 502 : res.status === 404 ? 404 : 400)
  return json
}
export const creditsOf = (staff: Staff, orgId: string): Promise<CreditView> => call(staff, "GET", undefined, `?org=${encodeURIComponent(orgId)}`)
const reasonOf = (r: string) => { const t = (r ?? "").trim(); if (t.length < MIN_REASON) throw new ControlError(`A reason of at least ${MIN_REASON} characters is required.`); return t.slice(0, 300) }

export async function grantCredits(staff: Staff, orgId: string, amountUsd: number, expiresInDays: number | null, reason: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can grant credit.", 403)
  if (!(amountUsd > 0) || amountUsd > MAX_GRANT_USD) throw new ControlError(`A grant is more than $0 and at most $${MAX_GRANT_USD.toLocaleString("en")}.`)
  if (amountUsd > ADMIN_GRANT_CEILING_USD && !roleAtLeast(staff.role, "superadmin")) throw new ControlError(`A grant above $${ADMIN_GRANT_CEILING_USD} needs a superadmin.`, 403)
  const why = reasonOf(reason)
  await call(staff, "POST", { orgId, action: "grant", amountUsd, expiresInDays, reason: why })
  await audit("platform.ai_credit.grant", staff, orgId, { amountUsd, expiresInDays, reason: why })
}
export async function adjustCredits(staff: Staff, orgId: string, amountUsd: number, reason: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can adjust credit.", 403)
  if (!Number.isFinite(amountUsd) || amountUsd === 0 || Math.abs(amountUsd) > MAX_GRANT_USD) throw new ControlError("An adjustment is a non-zero amount of at most $100,000.")
  if (Math.abs(amountUsd) > ADMIN_GRANT_CEILING_USD && !roleAtLeast(staff.role, "superadmin")) throw new ControlError(`An adjustment above $${ADMIN_GRANT_CEILING_USD} needs a superadmin.`, 403)
  const why = reasonOf(reason)
  await call(staff, "POST", { orgId, action: "adjust", amountUsd, reason: why })
  await audit("platform.ai_credit.adjust", staff, orgId, { amountUsd, reason: why })
}
