import { forwardToAnker } from "./anker-proxy"
import { audit } from "./audit"
import { ControlError, roleAtLeast } from "./tenant-control"
import type { Staff } from "./studio-credits"

/** The AI price list (Anker docs/architecture/58). A model with no price is not counted in any workspace's AI allowance. */
export interface PriceRow { model: string; calls30d: number; unpriced30d: number; source: "table" | "catalog" | "none"; priceIn: number | null; priceOut: number | null; verified: boolean; note: string | null }

async function call(staff: Staff, method: "GET" | "POST", body?: unknown): Promise<any> {
  const res = await forwardToAnker({ path: "admin/model-prices", method, body: body ? JSON.stringify(body) : undefined, contentType: body ? "application/json" : null, staffEmail: staff.email })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status >= 500 ? 502 : 400)
  return json
}
export interface UnitPriceRow { unit: string; priceUsd: number; note: string | null; verified: boolean; events30d: number; qty30d: number; usd30d: number }
export async function listPrices(staff: Staff): Promise<PriceRow[]> { return (await call(staff, "GET")).prices ?? [] }
export async function listPricesAndUnits(staff: Staff): Promise<{ prices: PriceRow[]; units: UnitPriceRow[] }> { const j = await call(staff, "GET"); return { prices: j.prices ?? [], units: j.units ?? [] } }

export async function saveUnitPrice(staff: Staff, input: { unit: string; priceUsd: string; verified: boolean; note: string }): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change prices.", 403)
  const p = Number(input.priceUsd)
  if (!Number.isFinite(p) || p < 0) throw new ControlError("The price is US dollars for one unit: enter a number, zero or more.")
  await call(staff, "POST", { unit: input.unit, priceUsd: p, verified: input.verified, note: input.note.trim() || null })
  await audit("platform.unit_price.save", staff, null, { unit: input.unit, priceUsd: p, verified: input.verified })
}

export async function savePrice(staff: Staff, input: { model: string; priceIn: string; priceOut: string; verified: boolean; note: string }): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change prices.", 403)
  const pi = Number(input.priceIn), po = Number(input.priceOut)
  if (!input.model.trim()) throw new ControlError("Choose a model.")
  if (!Number.isFinite(pi) || !Number.isFinite(po) || pi < 0 || po < 0) throw new ControlError("Prices are US dollars per million tokens: enter two numbers, zero or more.")
  await call(staff, "POST", { model: input.model.trim(), priceIn: pi, priceOut: po, verified: input.verified, note: input.note.trim() || null })
  await audit("platform.model_price.save", staff, null, { model: input.model.trim(), priceIn: pi, priceOut: po, verified: input.verified })
}
