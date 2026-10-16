import { sql } from "./db"
import { audit } from "./audit"
import { ControlError, MIN_REASON, roleAtLeast, tellTenant } from "./tenant-control"
import type { Staff } from "./studio-credits"

/**
 * Where a workspace's content may be sent for AI processing, and the register of the providers that process data for Anker (Anker docs/architecture/54, D5 and D6).
 * Anker's AI router reads both tables. Every change needs a reason, is audited, and (for a workspace) is written to the workspace's own access log.
 */
export const PRESETS = [
  ["standard", "Standard", "Content may go to any configured AI provider (today's behaviour)."],
  ["eu_only", "EU only", "Content goes only to providers whose region is the EU, or to our own servers. If none is available, the feature says so and nothing is sent."],
  ["no_external", "No external provider", "Content is processed only on our own servers. Needs a self-hosted model, which is not running yet."],
] as const
export type Preset = (typeof PRESETS)[number][0]
export const REGIONS = ["eu", "us", "sg", "self", "other", "unknown"] as const
const reasonOf = (r: string) => { const t = (r ?? "").trim(); if (t.length < MIN_REASON) throw new ControlError(`A reason of at least ${MIN_REASON} characters is required.`); return t.slice(0, 500) }

export interface PolicyView { org: { id: string; name: string }; preset: Preset; updatedBy: string | null; updatedAt: string | null; selfHostedAvailable: boolean; regions: { provider: string; region: string; active: boolean }[] }

export async function loadPolicy(orgId: string): Promise<PolicyView | null> {
  const org = ((await sql`SELECT id, name FROM organizations WHERE id = ${orgId}`) as any[])[0]
  if (!org) return null
  const p = ((await sql`SELECT preset, updated_by, updated_at FROM workspace_data_policy WHERE org_id = ${orgId}`) as any[])[0]
  const flag = ((await sql`SELECT enabled FROM platform_flags WHERE key = 'ai_self_hosted_lane'`) as any[])[0]
  const regions = (await sql`SELECT provider, region, active FROM ai_subprocessors WHERE role IN ('ai_model','self_hosted') ORDER BY active DESC, provider`) as any[]
  return { org, preset: (p?.preset as Preset) ?? "standard", updatedBy: p?.updated_by ?? null, updatedAt: p?.updated_at ? new Date(p.updated_at).toISOString() : null, selfHostedAvailable: !!flag?.enabled, regions }
}

export async function setPolicy(staff: Staff, orgId: string, preset: string, reasonText: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change a workspace's data policy.", 403)
  if (!PRESETS.some(([k]) => k === preset)) throw new ControlError("Unknown policy.")
  const reason = reasonOf(reasonText)
  const v = await loadPolicy(orgId)
  if (!v) throw new ControlError("Unknown workspace.", 404)
  if (preset === "no_external" && !v.selfHostedAvailable) throw new ControlError("No self-hosted model is running yet, so this policy cannot be chosen. It would leave the workspace with no AI at all.")
  await sql`INSERT INTO workspace_data_policy (org_id, preset, updated_by) VALUES (${orgId}, ${preset}, ${staff.email})
    ON CONFLICT (org_id) DO UPDATE SET preset = EXCLUDED.preset, updated_by = EXCLUDED.updated_by, updated_at = now()`
  await audit("platform.data_policy.set", staff, orgId, { from: v.preset, to: preset, reason })
  await tellTenant(orgId, staff, "staff_data_policy_set", { from: v.preset, to: preset, reason })
}

// ───────────── sub-processor register ─────────────
export interface Subprocessor {
  slug: string; provider: string; role: string; purpose: string; region: string; region_basis: string; data_classes: string[]; dpa_status: string; training_opt_out: string
  retention: string | null; terms_url: string | null; last_verified: string | null; active: boolean; public: boolean; notes: string | null; updated_by: string | null
}
export async function listSubprocessors(): Promise<Subprocessor[]> {
  const rows = (await sql`SELECT * FROM ai_subprocessors ORDER BY active DESC, role, provider`) as any[]
  return rows.map((r) => ({ ...r, last_verified: r.last_verified ? (r.last_verified instanceof Date ? r.last_verified.toISOString() : String(r.last_verified)).slice(0, 10) : null }))
}

export interface SubprocessorInput { slug: string; purpose: string; region: string; regionBasis: string; dpaStatus: string; trainingOptOut: string; retention?: string; termsUrl?: string; lastVerified?: string; active: boolean; public: boolean; notes?: string; dataClasses?: string; reason: string }
export async function saveSubprocessor(staff: Staff, i: SubprocessorInput): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change the sub-processor register.", 403)
  const reason = reasonOf(i.reason)
  if (!(REGIONS as readonly string[]).includes(i.region)) throw new ControlError("Unknown region.")
  if (!["inferred", "confirmed"].includes(i.regionBasis)) throw new ControlError("Unknown region basis.")
  if (!["unverified", "requested", "signed"].includes(i.dpaStatus)) throw new ControlError("Unknown agreement status.")
  if (!["unverified", "yes", "no"].includes(i.trainingOptOut)) throw new ControlError("Unknown training status.")
  if (i.termsUrl && !/^https:\/\/[^\s]+$/.test(i.termsUrl.trim())) throw new ControlError("The terms link must start with https://")
  if (!(i.purpose ?? "").trim()) throw new ControlError("Say what the provider is used for.")
  // A claim of 'confirmed' or 'signed' must say when it was checked.
  if ((i.regionBasis === "confirmed" || i.dpaStatus === "signed" || i.trainingOptOut === "yes") && !i.lastVerified) throw new ControlError("Give the date you checked this with the provider.")
  const before = ((await sql`SELECT region, region_basis, dpa_status, training_opt_out, active, public FROM ai_subprocessors WHERE slug = ${i.slug}`) as any[])[0]
  if (!before) throw new ControlError("Unknown provider.", 404)
  const classes = (i.dataClasses ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 12)
  await sql`UPDATE ai_subprocessors SET purpose = ${i.purpose.trim()}, region = ${i.region}, region_basis = ${i.regionBasis}, dpa_status = ${i.dpaStatus}, training_opt_out = ${i.trainingOptOut},
      retention = ${i.retention?.trim() || null}, terms_url = ${i.termsUrl?.trim() || null}, last_verified = ${i.lastVerified || null}, active = ${i.active}, public = ${i.public},
      notes = ${i.notes?.trim() || null}, data_classes = ${classes}, updated_by = ${staff.email}, updated_at = now() WHERE slug = ${i.slug}`
  await audit("platform.subprocessor.set", staff, i.slug, { from: before, to: { region: i.region, region_basis: i.regionBasis, dpa_status: i.dpaStatus, training_opt_out: i.trainingOptOut, active: i.active, public: i.public }, reason })
}
