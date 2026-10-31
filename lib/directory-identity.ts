import { sql } from "./db"
import { audit } from "./audit"
import { forwardToAnker } from "./anker-proxy"
import { ControlError, MIN_REASON, roleAtLeast } from "./tenant-control"
import type { Staff } from "./studio-credits"

/**
 * The directory identity review queue, the operator side (Anker docs/architecture/55, E1). Anker's detector proposes pairs of firms or people that may be one record; a person
 * decides here: the same, not the same (remembered, never asked again), or related (a parent brand and its programme). A pair confirmed as the same can then be MERGED (an atomic, reversible
 * merge run by Anker, undoable for 90 days), and a pair decided as related can be applied as a one-level hierarchy (docs/architecture/55 E2 and E3).
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
/** Records a decision. `related` names which of the two is the parent. A pair decided `same` waits for a separate, explicit merge (mergePair). */
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

async function act(staff: Staff, body: Record<string, unknown>): Promise<any> {
  const res = await forwardToAnker({ path: "admin/directory-identity", method: "POST", body: JSON.stringify(body), contentType: "application/json", staffEmail: staff.email } as any)
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status >= 500 ? 502 : res.status === 404 ? 404 : 409)
  return json
}
export interface MergePlanView { fills: string[]; conflicts: string[]; moves: Array<{ table: string; n: number; workspace: boolean }>; drops: Array<{ table: string; n: number }>; workspaceRefs: number; blockers: string[]; fillSkippedBecauseOfSource: boolean }
/** What a merge would do, in words a person can read: nothing is changed. */
export async function planPair(staff: Staff, candidateId: number, survivorId: string): Promise<MergePlanView> {
  const p = await act(staff, { action: "plan", candidateId, survivorId })
  return { fills: Object.keys(p.fills ?? {}), conflicts: p.conflicts ?? [], moves: (p.moves ?? []).map((m: any) => ({ table: m.table, n: m.n, workspace: m.workspace })), drops: p.drops ?? [], workspaceRefs: p.workspaceRefs ?? 0, blockers: p.blockers ?? [], fillSkippedBecauseOfSource: !!p.fillSkippedBecauseOfSource }
}
export const describePlan = (p: MergePlanView) => [
  p.blockers.length ? `Cannot merge: ${p.blockers.join(" ")}` : "Can be merged.",
  p.fills.length ? `Would fill empty fields: ${p.fills.join(", ")}.` : "Would fill no fields.", p.conflicts.length ? `Different values kept as the survivor's: ${p.conflicts.join(", ")}.` : "",
  p.fillSkippedBecauseOfSource ? "Fields are not copied because the other record comes from a source that is not recorded." : "",
  p.moves.length ? `Would move ${p.moves.reduce((a, m) => a + m.n, 0)} reference(s) (${p.workspaceRefs} in workspaces).` : "Nothing refers to the folded-in record.", p.drops.length ? `Would remove ${p.drops.reduce((a, d) => a + d.n, 0)} derived result row(s), regenerated by the next run.` : "",
].filter(Boolean).join(" ")
/** Merges a pair that has been confirmed as the same. Admin only; a reason is required when many workspace records are involved (Anker says so). */
export async function mergePair(staff: Staff, candidateId: number, survivorId: string, reason: string): Promise<{ mergeId: number; moved: number; filled: string[]; conflicts: string[] }> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can merge records.", 403)
  const c = ((await sql`SELECT kind, a_id, b_id, status FROM directory_candidates WHERE id = ${candidateId}`) as any[])[0]
  if (!c) throw new ControlError("Unknown candidate.", 404)
  if (c.status !== "same") throw new ControlError("Confirm the pair as the same first.", 409)
  const r = await act(staff, { action: "merge", candidateId, survivorId, reason: reason.trim().slice(0, 500) })
  await audit("platform.directory.merge", staff, String(candidateId), { kind: c.kind, survivor: survivorId, loser: survivorId === c.a_id ? c.b_id : c.a_id, mergeId: r.mergeId, moved: r.moved, filled: r.filled, reason: reason.trim().slice(0, 500) || undefined })
  return r
}
/** The live merge of a candidate, for the Undo button. */
export async function mergeOf(candidateId: number): Promise<{ id: number; undoUntil: string } | null> {
  const r = ((await sql`SELECT id, undo_until FROM directory_merges WHERE candidate_id = ${candidateId} AND undone_at IS NULL ORDER BY id DESC LIMIT 1`) as any[])[0]
  return r ? { id: Number(r.id), undoUntil: r.undo_until } : null
}
export async function undoPair(staff: Staff, candidateId: number, reasonText: string): Promise<{ moved: number; fieldsKept: string[]; derivedNotRestored: number }> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can undo a merge.", 403)
  const reason = (reasonText ?? "").trim(); if (reason.length < MIN_REASON) throw new ControlError(`A reason of at least ${MIN_REASON} characters is required.`)
  const m = await mergeOf(candidateId); if (!m) throw new ControlError("There is no merge to undo for this pair.", 404)
  const r = await act(staff, { action: "undo", mergeId: m.id })
  await audit("platform.directory.undo", staff, String(candidateId), { mergeId: m.id, moved: r.moved, fieldsKept: r.fieldsKept, reason: reason.slice(0, 500) })
  return r
}
/** Applies a pair decided as related as one level of hierarchy: the child becomes a programme of the parent. */
export async function applyHierarchy(staff: Staff, candidateId: number): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change the hierarchy.", 403)
  const r = await act(staff, { action: "related", candidateId })
  await audit("platform.directory.hierarchy", staff, String(candidateId), { parent: r.parentId, child: r.childId })
}
