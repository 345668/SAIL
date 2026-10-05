import { sql } from "./db"
import { setFlag, listFlags, roleAtLeast, ControlError, type Role } from "./tenant-control"

/**
 * Staff view of Anker's send executor (Anker docs/architecture/46, P2). Metadata only: counts, statuses, ages and workspace names. Never a recipient, a subject,
 * a message or a reason (a reason can name an address). The pause is a platform flag the executor checks before every send.
 */
export const PAUSE_KEY = "outreach_sending_paused"
export const ENFORCE_KEY = "outreach_require_authorization"
/** Enforcement may be switched on only after this many days with no send that skipped an authorization (Anker docs/architecture/46, P3). */
export const QUIET_DAYS = 14
/** A flag row whose updated_at is when the shadow log began recording every send that skipped authorization. An empty log means nothing until it has been recording for the whole window. */
export const SHADOW_KEY = "outreach_shadow_log_started"

export interface SendingOverview {
  paused: { on: boolean; by: string | null; at: string | null }
  maintenance: boolean
  counts: Array<{ status: string; n: number }>
  waiting: { n: number; oldestMinutes: number | null }
  activeAuthorizations: number
  sentToday: number
  problems: Array<{ org_name: string | null; status: string; n: number; oldestHours: number | null }>
  enforcement: { on: boolean; rolloutPct: number; unauthorized: Array<{ path: string; n: number; lastAt: string }>; quietDays: number; shadowSince: string | null; observedDays: number }
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v))

export async function overview(): Promise<SendingOverview> {
  const flags = await listFlags()
  const f = flags.find((x) => x.key === PAUSE_KEY)
  const counts = ((await sql`SELECT status, count(*)::int AS n FROM send_items WHERE created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC`) as any[]).map((r) => ({ status: r.status, n: Number(r.n) }))
  const [w] = (await sql`SELECT count(*)::int AS n, floor(extract(epoch FROM (now() - min(send_after))) / 60)::int AS oldest FROM send_items WHERE status = 'approved' AND send_after <= now()`) as any[]
  const [a] = (await sql`SELECT count(*)::int AS n FROM send_authorizations WHERE status = 'active'`) as any[]
  const [t] = (await sql`SELECT count(*)::int AS n FROM send_items WHERE status = 'sent' AND sent_at >= date_trunc('day', now())`) as any[]
  const problems = ((await sql`SELECT o.name AS org_name, i.status, count(*)::int AS n, floor(extract(epoch FROM (now() - min(coalesce(i.claimed_at, i.created_at)))) / 3600)::int AS oldest
    FROM send_items i LEFT JOIN organizations o ON o.id = i.org_id
    WHERE i.status IN ('failed','unknown') OR (i.status = 'sending' AND i.claimed_at < now() - interval '30 minutes')
    GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 25`) as any[]).map((r) => ({ org_name: r.org_name, status: r.status, n: Number(r.n), oldestHours: r.oldest === null ? null : Number(r.oldest) }))
  const ef = flags.find((x) => x.key === ENFORCE_KEY)
  const sh = flags.find((x) => x.key === SHADOW_KEY)
  const shadowSince = sh ? iso(sh.updated_at) : null
  const observedDays = shadowSince ? Math.floor((Date.now() - new Date(shadowSince).getTime()) / 86_400_000) : 0
  const unauthorized = ((await sql`SELECT target_label AS path, count(*)::int AS n, max(created_at) AS last_at FROM audit_events WHERE action = 'send.unauthorized_path' AND created_at > now() - ${QUIET_DAYS} * interval '1 day' GROUP BY 1 ORDER BY 2 DESC`) as any[])
    .map((r) => ({ path: String(r.path ?? "unlabelled"), n: Number(r.n), lastAt: iso(r.last_at) }))
  return { enforcement: { on: !!ef?.enabled, rolloutPct: Number(ef?.rollout_pct ?? 100), unauthorized, quietDays: QUIET_DAYS, shadowSince, observedDays }, paused: { on: !!f?.enabled, by: f?.updated_by ?? null, at: f ? iso(f.updated_at) : null }, maintenance: !!flags.find((x) => x.key === "maintenance")?.enabled,
    counts, waiting: { n: Number(w?.n ?? 0), oldestMinutes: w?.oldest === null || w?.oldest === undefined ? null : Number(w.oldest) }, activeAuthorizations: Number(a?.n ?? 0), sentToday: Number(t?.n ?? 0), problems }
}

/** Pause or resume all outreach sending for every workspace. Admin and above, with a reason; audited by the flag editor. */
export async function setSendingPaused(staff: { id: string; email: string; role: Role }, paused: boolean, reason: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can pause sending.", 403)
  await setFlag(staff, { key: PAUSE_KEY, enabled: paused, rolloutPct: 100, description: "Stops the send executor for every workspace: authorized mail waits, nothing goes", reason })
}

/**
 * Turn enforcement on (an outreach email with no send authorization is refused) or off. Superadmin only, with a reason. Turning it on is refused while any send has skipped
 * an authorization in the last QUIET_DAYS days: the log must have been quiet. Turning it off is always allowed.
 */
export async function setEnforcement(staff: { id: string; email: string; role: Role }, on: boolean, rolloutPct: number, reason: string): Promise<void> {
  if (!roleAtLeast(staff.role, "superadmin")) throw new ControlError("Only a superadmin can change enforcement.", 403)
  if (on) {
    // An empty log is only good news once the log has been recording for the whole window.
    const [m] = (await sql`SELECT updated_at FROM platform_flags WHERE key = ${SHADOW_KEY}`) as any[]
    const days = m ? Math.floor((Date.now() - new Date(m.updated_at).getTime()) / 86_400_000) : 0
    if (!m || days < QUIET_DAYS) throw new ControlError(`Not yet: the log of sends that skip authorization has been recording for ${days} day${days === 1 ? "" : "s"}${m ? ` (since ${iso(m.updated_at).slice(0, 10)})` : ""}. Enforcement needs ${QUIET_DAYS} quiet days first.`)
    const rows = (await sql`SELECT target_label AS path, count(*)::int AS n FROM audit_events WHERE action = 'send.unauthorized_path' AND created_at > now() - ${QUIET_DAYS} * interval '1 day' GROUP BY 1 ORDER BY 2 DESC`) as any[]
    if (rows.length) throw new ControlError(`Not yet: sends that skipped an authorization were logged in the last ${QUIET_DAYS} days (${rows.map((r) => `${r.path} ${r.n}`).join(", ")}). Enforcement needs ${QUIET_DAYS} quiet days first.`)
  }
  await setFlag(staff, { key: ENFORCE_KEY, enabled: on, rolloutPct, description: "An outreach email with no send authorization is refused", reason })
}
