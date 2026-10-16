import { sql } from "./db"
import { audit } from "./audit"
import { ControlError, MIN_REASON, roleAtLeast } from "./tenant-control"
import type { Staff } from "./studio-credits"

/**
 * The directory source and licence register, the operator side (Anker docs/architecture/54, D1). Every source of rows in the shared investor directory has a record of
 * what it may be used for. Anker reads the same table in its send and LinkedIn queue gates. Every change needs a reason and is audited.
 */
export const PURPOSES = [
  ["internal_matching", "Internal matching"],
  ["outreach_email", "Outreach by email"],
  ["outreach_linkedin", "Outreach on LinkedIn"],
  ["display_to_customers", "Show to customers"],
  ["resale", "Resale"],
] as const
export const KINDS = ["vendor_purchase", "partner_list", "customer_upload", "public_web", "webinar_signup", "seed", "crm_sync", "unknown"] as const
export const STATUSES = ["recorded", "unreviewed", "restricted", "withdrawn"] as const
/** Withdrawing a batch larger than this needs a superadmin. */
export const WITHDRAW_ADMIN_CEILING = 1000

export interface SourceView {
  source: string; label: string | null; kind: string; supplier: string | null; acquired_at: string | null; licence_summary: string | null
  permitted_use: string[]; forbidden_use: string | null; lawful_basis_note: string | null; status: string; reviewed_by: string | null; reviewed_at: string | null
  withdraw_reason: string | null; withdrawn_at: string | null; purged_at: string | null; purge_on: string | null; people: number; firms: number
}
/** Days a withdrawn source is held (hidden and blocked, but restorable) before Anker deletes its people. */
export const HOLD_DAYS = 30

const reasonOf = (r: string) => {
  const t = (r ?? "").trim()
  if (t.length < MIN_REASON) throw new ControlError(`A reason of at least ${MIN_REASON} characters is required.`)
  return t.slice(0, 500)
}

export async function listSources(): Promise<SourceView[]> {
  const rows = (await sql`SELECT s.*, COALESCE(p.n, 0)::int AS people, COALESCE(f.n, 0)::int AS firms
    FROM directory_sources s
    LEFT JOIN (SELECT COALESCE(NULLIF(TRIM(source), ''), 'unknown') AS source, count(*) AS n FROM investors GROUP BY 1) p ON p.source = s.source
    LEFT JOIN (SELECT COALESCE(NULLIF(TRIM(source), ''), 'unknown') AS source, count(*) AS n FROM investment_firms GROUP BY 1) f ON f.source = s.source
    ORDER BY (s.status = 'unreviewed') DESC, COALESCE(p.n, 0) DESC, s.source`) as any[]
  const day = (v: unknown) => (v ? new Date(v as any).toISOString().slice(0, 10) : null)
  return rows.map((r) => ({ ...r, acquired_at: r.acquired_at ? String(r.acquired_at).slice(0, 10) : null, reviewed_at: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
    withdrawn_at: day(r.withdrawn_at), purged_at: day(r.purged_at), purge_on: r.withdrawn_at && !r.purged_at ? day(new Date(r.withdrawn_at).getTime() + HOLD_DAYS * 86_400_000) : null }))
}

export interface ReviewInput {
  source: string; status: string; kind: string; label?: string; supplier?: string; acquiredAt?: string; licenceSummary?: string
  permittedUse: string[]; forbiddenUse?: string; lawfulBasisNote?: string; reason: string
}

/** Records the review of a source, or registers a new one. `recorded` needs a licence summary and a permitted use; `restricted` needs the list of what is still allowed. */
export async function reviewSource(staff: Staff, i: ReviewInput): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change the source register.", 403)
  const src = (i.source ?? "").trim()
  if (!src || src.length > 200) throw new ControlError("Enter the source key (the value in the directory's source column).")
  if (!(["recorded", "unreviewed", "restricted"] as string[]).includes(i.status)) throw new ControlError("Choose recorded, unreviewed or restricted. Use Withdraw to withdraw a batch.")
  if (!(KINDS as readonly string[]).includes(i.kind)) throw new ControlError("Choose what kind of source this is.")
  const uses = [...new Set(i.permittedUse ?? [])]
  if (uses.some((u) => !PURPOSES.some(([k]) => k === u))) throw new ControlError("Unknown permitted use.")
  const licence = (i.licenceSummary ?? "").trim()
  if (i.status === "recorded" && (!licence || !uses.length)) throw new ControlError("A recorded source needs a licence summary and at least one permitted use.")
  if (i.status === "restricted" && !(i.forbiddenUse ?? "").trim()) throw new ControlError("A restricted source needs a note on what is not allowed.")
  const finalUses = i.status === "unreviewed" ? ["internal_matching"] : uses
  const reason = reasonOf(i.reason)
  const before = ((await sql`SELECT status, permitted_use FROM directory_sources WHERE source = ${src}`) as any[])[0]
  if (before?.status === "withdrawn") throw new ControlError("This source is withdrawn. Restore it first.")
  await sql`INSERT INTO directory_sources (source, label, kind, supplier, acquired_at, licence_summary, permitted_use, forbidden_use, lawful_basis_note, status, reviewed_by, reviewed_at)
    VALUES (${src}, ${i.label?.trim() || src}, ${i.kind}, ${i.supplier?.trim() || null}, ${i.acquiredAt || null}, ${licence || null}, ${finalUses}, ${i.forbiddenUse?.trim() || null}, ${i.lawfulBasisNote?.trim() || null}, ${i.status}, ${staff.email}, now())
    ON CONFLICT (source) DO UPDATE SET label = EXCLUDED.label, kind = EXCLUDED.kind, supplier = EXCLUDED.supplier, acquired_at = EXCLUDED.acquired_at, licence_summary = EXCLUDED.licence_summary,
      permitted_use = EXCLUDED.permitted_use, forbidden_use = EXCLUDED.forbidden_use, lawful_basis_note = EXCLUDED.lawful_basis_note, status = EXCLUDED.status,
      reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now(), updated_at = now()`
  await audit("platform.directory_source.review", staff, src, { from: before ? { status: before.status, permitted_use: before.permitted_use } : null, to: { status: i.status, permitted_use: finalUses }, reason })
}

/** Withdraws a batch: its people are hidden from matching and discovery and all use is blocked at once. After the hold, Anker's maintenance job tombstones and deletes them. A batch over 1,000 people needs a superadmin. */
export async function withdrawSource(staff: Staff, source: string, reasonText: string): Promise<{ people: number; firms: number }> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can withdraw a source.", 403)
  const reason = reasonOf(reasonText)
  const s = ((await sql`SELECT source, status FROM directory_sources WHERE source = ${source}`) as any[])[0]
  if (!s) throw new ControlError("Unknown source.", 404)
  if (s.status === "withdrawn") throw new ControlError("Already withdrawn.")
  const p = ((await sql`SELECT count(*)::int AS n FROM investors WHERE COALESCE(NULLIF(TRIM(source), ''), 'unknown') = ${source}`) as any[])[0]
  const f = ((await sql`SELECT count(*)::int AS n FROM investment_firms WHERE COALESCE(NULLIF(TRIM(source), ''), 'unknown') = ${source}`) as any[])[0]
  const people = Number(p?.n ?? 0), firms = Number(f?.n ?? 0)
  if (people > WITHDRAW_ADMIN_CEILING && !roleAtLeast(staff.role, "superadmin")) throw new ControlError(`Withdrawing more than ${WITHDRAW_ADMIN_CEILING.toLocaleString()} people needs a superadmin.`, 403)
  await sql`UPDATE directory_sources SET status = 'withdrawn', withdrawn_at = now(), withdraw_reason = ${reason}, reviewed_by = ${staff.email}, reviewed_at = now(), updated_at = now() WHERE source = ${source}`
  // Hide only rows that were visible, and remember which, so a restore switches back exactly these.
  await sql`UPDATE investors SET is_active = false, hidden_by_source = true WHERE COALESCE(NULLIF(TRIM(source), ''), 'unknown') = ${source} AND COALESCE(is_active, true) = true AND NOT hidden_by_source`
  await audit("platform.directory_source.withdraw", staff, source, { people, firms, reason })
  return { people, firms }
}

/** Brings a withdrawn source back as unreviewed (matching only) so it has to be reviewed again. */
export async function restoreSource(staff: Staff, source: string, reasonText: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can restore a source.", 403)
  const reason = reasonOf(reasonText)
  const s = ((await sql`SELECT status, purged_at FROM directory_sources WHERE source = ${source}`) as any[])[0]
  if (!s) throw new ControlError("Unknown source.", 404)
  if (s.status !== "withdrawn") throw new ControlError("Only a withdrawn source can be restored.")
  if (s.purged_at) throw new ControlError("This source's people have already been deleted. Import it again if you are allowed to.")
  await sql`UPDATE directory_sources SET status = 'unreviewed', permitted_use = ARRAY['internal_matching'], withdrawn_at = NULL, withdraw_reason = NULL, reviewed_by = ${staff.email}, reviewed_at = now(), updated_at = now() WHERE source = ${source}`
  await sql`UPDATE investors SET is_active = true, hidden_by_source = false WHERE COALESCE(NULLIF(TRIM(source), ''), 'unknown') = ${source} AND hidden_by_source`
  await audit("platform.directory_source.restore", staff, source, { reason })
}
