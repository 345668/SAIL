import { sql } from "./db"
import { setFlag, listFlags, roleAtLeast, ControlError, type Role } from "./tenant-control"

/**
 * Staff view of Anker's send executor (Anker docs/architecture/46, P2). Metadata only: counts, statuses, ages and workspace names. Never a recipient, a subject,
 * a message or a reason (a reason can name an address). The pause is a platform flag the executor checks before every send.
 */
export const PAUSE_KEY = "outreach_sending_paused"

export interface SendingOverview {
  paused: { on: boolean; by: string | null; at: string | null }
  maintenance: boolean
  counts: Array<{ status: string; n: number }>
  waiting: { n: number; oldestMinutes: number | null }
  activeAuthorizations: number
  sentToday: number
  problems: Array<{ org_name: string | null; status: string; n: number; oldestHours: number | null }>
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
  return { paused: { on: !!f?.enabled, by: f?.updated_by ?? null, at: f ? iso(f.updated_at) : null }, maintenance: !!flags.find((x) => x.key === "maintenance")?.enabled,
    counts, waiting: { n: Number(w?.n ?? 0), oldestMinutes: w?.oldest === null || w?.oldest === undefined ? null : Number(w.oldest) }, activeAuthorizations: Number(a?.n ?? 0), sentToday: Number(t?.n ?? 0), problems }
}

/** Pause or resume all outreach sending for every workspace. Admin and above, with a reason; audited by the flag editor. */
export async function setSendingPaused(staff: { id: string; email: string; role: Role }, paused: boolean, reason: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can pause sending.", 403)
  await setFlag(staff, { key: PAUSE_KEY, enabled: paused, rolloutPct: 100, description: "Stops the send executor for every workspace: authorized mail waits, nothing goes", reason })
}
