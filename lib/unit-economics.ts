import { forwardToAnker } from "./anker-proxy"
import { audit } from "./audit"
import { ControlError, roleAtLeast } from "./tenant-control"
import type { Staff } from "./studio-credits"

/** What the platform spends on AI and media (Anker docs/architecture/58). List-price totals, with the provider's bill entered by hand beside them. */
export interface Economics {
  month: string
  totals: { aiUsd: number; unitsUsd: number; workspaceUsd: number; platformUsd: number }
  workspaces: Array<{ orgId: string; name: string | null; usd: number; limit: number | null; pct: number | null }>
  tasks: Array<{ task: string; calls: number; usd: number; runs: number; p50: number | null; p95: number | null }>
  units: Array<{ unit: string; events: number; qty: number; usd: number }>
  bills: Array<{ month: string; provider: string; amountUsd: number; note: string | null }>
}

async function call(staff: Staff, method: "GET" | "POST", body?: unknown): Promise<any> {
  const res = await forwardToAnker({ path: "admin/unit-economics", method, body: body ? JSON.stringify(body) : undefined, contentType: body ? "application/json" : null, staffEmail: staff.email })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status >= 500 ? 502 : 400)
  return json
}
export async function getEconomics(staff: Staff): Promise<Economics> { return call(staff, "GET") }

export async function saveBill(staff: Staff, input: { month: string; provider: string; amountUsd: string; note: string }): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can enter a bill.", 403)
  const amount = Number(input.amountUsd)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new ControlError("Enter the month as YYYY-MM.")
  if (!input.provider.trim()) throw new ControlError("Enter the provider's name.")
  if (!Number.isFinite(amount) || amount < 0) throw new ControlError("Enter the amount billed in US dollars.")
  await call(staff, "POST", { month: input.month, provider: input.provider.trim(), amountUsd: amount, note: input.note.trim() || null })
  await audit("platform.provider_bill.save", staff, null, { month: input.month, provider: input.provider.trim().toLowerCase(), amountUsd: amount })
}
