import { sql } from "./db"
import { audit } from "./audit"
import { forwardToAnker } from "./anker-proxy"
import { ControlError, MIN_REASON, roleAtLeast } from "./tenant-control"
import type { Staff } from "./studio-credits"

/**
 * The directory identity review queue, the operator side (Anker docs/architecture/55, E1). Anker's detector proposes pairs of firms or people that may be one record; a person
 * decides here: the same, not the same (remembered, never asked again), or related (a parent brand and its programme). In this slice a decision is only recorded: nothing is merged.
 * The audit holds record ids and the decision, never names.
 */
export type Kind = "firm" | "person"
export type Tier = "certain" | "probable" | "possible"
export const PAGE = 20

export interface Counts { kind: Kind; tier: Tier; status: string; n: number }
export async function counts(): Promise<Counts[]> {
  const rows = (await sql`SELECT kind, tier, status, count(*)::int AS n FROM directory_candidates GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`) as any[]
  return rows.map((r) => ({ kind: r.kind, tier: r.tier, status: r.status, n: Number(r.n) }))
}

export interface FirmView { id: string; name: string | null; website: string | null; source: string | null; location: string | null; people: number }
export interface PersonView { id: string; name: string; title: string | null; email: string | null; profile: string | null; firm: string | null; source: string | null }
export interface CandidateView { id: number; kind: Kind; tier: Tier; score: number; suggest: "same" | "related"; evidence: any; status: string; a: FirmView | PersonView | null; b: FirmView | PersonView | null }

export async function listCandidates(o: { kind: Kind; tiers: Tier[]; status: string; page: number }): Promise<{ total: number; items: CandidateView[] }> {
  const tiers = o.tiers.length ? o.tiers : (["certain", "probable"] as Tier[])
  const page = Math.max(0, Math.floor(o.page) || 0)
  const total = Number(((await sql`SELECT count(*)::int AS n FROM directory_candidates WHERE kind = ${o.kind} AND status = ${o.status} AND tier = ANY(${tiers}::text[])`) as any[])[0]?.n ?? 0)
  const rows = (await sql`SELECT * FROM directory_candidates WHERE kind = ${o.kind} AND status = ${o.status} AND tier = ANY(${tiers}::text[]) ORDER BY CASE tier WHEN 'certain' THEN 0 WHEN 'probable' THEN 1 ELSE 2 END, score DESC, id LIMIT ${PAGE} OFFSET ${page * PAGE}`) as any[]
  const ids = [...new Set(rows.flatMap((r) => [r.a_id, r.b_id]))]
  const byId = new Map<string, any>()
  if (ids.length) {
    if (o.kind === "firm") {
      const f = (await sql`SELECT f.id, f.name, f.website, f.source, COALESCE(f.hq_location, f.location) AS location, (SELECT count(*)::int FROM investors i WHERE i.firm_id = f.id) AS people FROM investment_firms f WHERE f.id = ANY(${ids}::text[])`) as any[]
      for (const x of f) byId.set(String(x.id), { id: String(x.id), name: x.name, website: x.website, source: x.source, location: x.location, people: Number(x.people) } satisfies FirmView)
    } else {
      const p = (await sql`SELECT i.id, i.first_name, i.last_name, i.title, i.email, COALESCE(i.person_linkedin_url, i.linkedin_url) AS profile, i.source, f.name AS firm FROM investors i LEFT JOIN investment_firms f ON f.id = i.firm_id WHERE i.id = ANY(${ids}::text[])`) as any[]
      for (const x of p) byId.set(String(x.id), { id: String(x.id), name: `${x.first_name ?? ""} ${x.last_name ?? ""}`.trim(), title: x.title, email: x.email, profile: x.profile, firm: x.firm, source: x.source } satisfies PersonView)
    }
  }
  return { total, items: rows.map((r) => ({ id: Number(r.id), kind: r.kind, tier: r.tier, score: Number(r.score), suggest: r.suggest, evidence: r.evidence, status: r.status, a: byId.get(r.a_id) ?? null, b: byId.get(r.b_id) ?? null })) }
}

export type Decision = "same" | "distinct" | "related"
/** Records a decision. `related` names which of the two is the parent. A merge for 'same' is a later slice, so it stays confirmed and waiting. */
export async function decide(staff: Staff, id: number, decision: string, o: { parentId?: string; reason?: string } = {}): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can decide on a candidate.", 403)
  if (!["same", "distinct", "related"].includes(decision)) throw new ControlError("Unknown decision.")
  const c = ((await sql`SELECT id, kind, a_id, b_id, status FROM directory_candidates WHERE id = ${id}`) as any[])[0]
  if (!c) throw new ControlError("Unknown candidate.", 404)
  if (c.status !== "open") throw new ControlError(c.status === "merged" ? "This pair has already been merged." : "This pair has already been decided or is no longer current. Reopen it first.", 409)
  const reason = (o.reason ?? "").trim().slice(0, 500)
  if (decision === "related") {
    if (c.kind !== "firm") throw new ControlError("Only firms can be related (parent and programme).")
    if (o.parentId !== c.a_id && o.parentId !== c.b_id) throw new ControlError("Choose which firm is the parent.")
  }
  const parent = decision === "related" ? o.parentId! : null
  const done = (await sql`UPDATE directory_candidates SET status = ${decision}, parent_id = ${parent}, decided_by = ${staff.email}, decided_at = now(), reason = ${reason || null}, updated_at = now() WHERE id = ${id} AND status = 'open' RETURNING id`) as any[]
  if (!done.length) throw new ControlError("Someone else decided this pair first.", 409)
  await audit("platform.directory_candidate.decide", staff, String(id), { kind: c.kind, a: c.a_id, b: c.b_id, decision, parent, reason: reason || undefined })
}

/** Puts a decided pair back in the queue. A merged pair cannot be reopened here. */
export async function reopen(staff: Staff, id: number, reasonText: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can reopen a candidate.", 403)
  const reason = (reasonText ?? "").trim()
  if (reason.length < MIN_REASON) throw new ControlError(`A reason of at least ${MIN_REASON} characters is required.`)
  const c = ((await sql`SELECT status, kind, a_id, b_id FROM directory_candidates WHERE id = ${id}`) as any[])[0]
  if (!c) throw new ControlError("Unknown candidate.", 404)
  if (!["same", "distinct", "related"].includes(c.status)) throw new ControlError("Only a decided pair can be reopened.", 409)
  await sql`UPDATE directory_candidates SET status = 'open', parent_id = NULL, decided_by = NULL, decided_at = NULL, reason = NULL, updated_at = now() WHERE id = ${id}`
  await audit("platform.directory_candidate.reopen", staff, String(id), { kind: c.kind, a: c.a_id, b: c.b_id, from: c.status, reason: reason.slice(0, 500) })
}

/** Asks Anker to run detection now (it also runs every night). */
export async function runDetectionNow(staff: Staff): Promise<{ firms: number; people: number }> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can run detection.", 403)
  const res = await forwardToAnker({ path: "admin/directory-identity", method: "POST", staffEmail: staff.email })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status >= 500 ? 502 : 400)
  await audit("platform.directory_identity.run", staff, null, { firms: json?.firms?.found, people: json?.people?.found })
  return { firms: Number(json?.firms?.found ?? 0), people: Number(json?.people?.found ?? 0) }
}
