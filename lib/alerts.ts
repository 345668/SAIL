import { sql } from "./db"
import { audit } from "./audit"
import { forwardToAnker } from "./anker-proxy"
import { ControlError, MIN_REASON, roleAtLeast } from "./tenant-control"
import type { Staff } from "./studio-credits"

/**
 * Alerts and incidents, the operator side (Anker docs/architecture/56, A1). Anker's evaluator opens and resolves incidents and sends the email; here a person reads them,
 * acknowledges, adds a note and, when it is fixed, resolves with the cause and the fix. If the problem is still there the evaluator reopens the incident within 24 hours.
 */
export interface Incident {
  id: number; rule_key: string; subject: string; severity: number; status: string; summary: string; evidence: Record<string, unknown>; runbook: string | null
  opened_at: string | null; last_seen_at: string; times_seen: number; acknowledged_by: string | null; acknowledged_at: string | null; resolved_at: string | null; resolved_by: string | null
  cause: string | null; fix: string | null
}
export interface Timeline { at: string; kind: string; channel: string | null; ok: boolean | null; actor: string | null; detail: string | null }
export interface Heartbeat { last_run_at: string | null; last_ok_at: string | null; rules_evaluated: number; open_incidents: number; error: string | null; ageMinutes: number | null; stale: boolean }

const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null)
const fix = (r: any): Incident => ({ ...r, id: Number(r.id), severity: Number(r.severity), times_seen: Number(r.times_seen), opened_at: iso(r.opened_at), last_seen_at: iso(r.last_seen_at)!, acknowledged_at: iso(r.acknowledged_at), resolved_at: iso(r.resolved_at) })

export async function heartbeat(now = Date.now()): Promise<Heartbeat> {
  const h = ((await sql`SELECT * FROM alert_heartbeat WHERE id = 1`) as any[])[0]
  const ok = h?.last_ok_at ? new Date(h.last_ok_at).getTime() : null
  const age = ok == null ? null : Math.round((now - ok) / 60000)
  return { last_run_at: iso(h?.last_run_at), last_ok_at: iso(h?.last_ok_at), rules_evaluated: Number(h?.rules_evaluated ?? 0), open_incidents: Number(h?.open_incidents ?? 0), error: h?.error ?? null, ageMinutes: age, stale: age == null || age > 30 }
}

export async function listOpen(): Promise<Incident[]> {
  return ((await sql`SELECT * FROM alert_incidents WHERE status IN ('open', 'acknowledged') ORDER BY severity, opened_at`) as any[]).map(fix)
}
export async function listRecent(limit = 30): Promise<Incident[]> {
  return ((await sql`SELECT * FROM alert_incidents WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT ${limit}`) as any[]).map(fix)
}
export async function timeline(id: number): Promise<Timeline[]> {
  return ((await sql`SELECT at, kind, channel, ok, actor, detail FROM alert_events WHERE incident_id = ${id} ORDER BY at, id`) as any[]).map((e) => ({ ...e, at: iso(e.at)! }))
}

const note = (t: string | undefined, max = 1000) => (t ?? "").trim().slice(0, max)
async function load(id: number) {
  const r = ((await sql`SELECT id, rule_key, subject, status FROM alert_incidents WHERE id = ${id}`) as any[])[0]
  if (!r) throw new ControlError("Unknown incident.", 404)
  return r
}
const event = (id: number, kind: string, actor: string, detail?: string) => sql`INSERT INTO alert_events (incident_id, kind, actor, detail) VALUES (${id}, ${kind}, ${actor}, ${detail || null})`

export async function acknowledge(staff: Staff, id: number, text?: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can acknowledge an incident.", 403)
  const r = await load(id)
  if (r.status !== "open") throw new ControlError(r.status === "acknowledged" ? "Already acknowledged." : "Only an open incident can be acknowledged.", 409)
  await sql`UPDATE alert_incidents SET status = 'acknowledged', acknowledged_by = ${staff.email}, acknowledged_at = now() WHERE id = ${id} AND status = 'open'`
  await event(id, "acknowledged", staff.email, note(text))
  await audit("platform.alert.acknowledge", staff, String(id), { rule: r.rule_key, subject: r.subject })
}

export async function addNote(staff: Staff, id: number, text: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can add a note.", 403)
  const t = note(text); if (!t) throw new ControlError("Write the note.")
  await load(id); await event(id, "note", staff.email, t)
  await audit("platform.alert.note", staff, String(id), {})
}

/** A person resolves an incident, saying what caused it and what fixed it. The cause and fix are required: they are what makes the history useful. */
export async function resolve(staff: Staff, id: number, o: { cause: string; fix: string }): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can resolve an incident.", 403)
  const cause = note(o.cause, 500), fixText = note(o.fix, 500)
  if (cause.length < MIN_REASON || fixText.length < MIN_REASON) throw new ControlError(`Say what caused it and what fixed it (at least ${MIN_REASON} characters each).`)
  const r = await load(id)
  if (r.status === "resolved") throw new ControlError("Already resolved.", 409)
  await sql`UPDATE alert_incidents SET status = 'resolved', resolved_at = now(), resolved_by = ${staff.email}, cause = ${cause}, fix = ${fixText} WHERE id = ${id} AND status <> 'resolved'`
  await event(id, "resolved", staff.email, `Cause: ${cause} Fix: ${fixText}`)
  await audit("platform.alert.resolve", staff, String(id), { rule: r.rule_key, subject: r.subject })
}

/** Sends a test message on every alert channel that is switched on and returns each result. The result holds no secrets. */
export async function sendTest(staff: Staff): Promise<{ configured: string[]; results: { channel: string; ok: boolean; error?: string }[] }> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can send a test notification.", 403)
  const res = await forwardToAnker({ path: "admin/alerts-test", method: "POST", staffEmail: staff.email })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status >= 500 ? 502 : 400)
  await audit("platform.alert.test", staff, null, { results: (json.results ?? []).map((r: any) => ({ channel: r.channel, ok: r.ok })) })
  return { configured: json.configured ?? [], results: json.results ?? [] }
}
