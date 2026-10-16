import { sql } from "./db"
import { audit } from "./audit"
import { ControlError, MIN_REASON, roleAtLeast } from "./tenant-control"
import type { Staff } from "./studio-credits"

/**
 * The alert rules page, the operator side (Anker docs/architecture/56, A2). The rule logic lives in Anker's code; what a person may change is stored in `alert_rule_settings`
 * and read by Anker at every evaluation: whether a rule is on, its severity, its threshold, a time-limited mute, and the quiet hours. Every change needs a reason and is audited.
 */
export const RULES = [
  { key: "cron_stale", label: "A scheduled job has stopped", text: "A job has not completed successfully for twice its interval.", severity: 2 },
  { key: "cron_stuck", label: "A scheduled job is stuck", text: "A run has been 'running' for over 15 minutes: the platform killed it.", severity: 2 },
  { key: "cron_failing", label: "A scheduled job keeps failing", text: "Three of the last five runs failed, including the latest.", severity: 2 },
  { key: "dependency_down", label: "A dependency is down", text: "The live dependency check reports a check as down (a secret, a mailbox, a provider).", severity: 2 },
  { key: "dependency_degraded", label: "A dependency has been degraded for days", text: "The same check degraded three nights running. Digest only.", severity: 3 },
  { key: "ai_failure_rate", label: "AI calls are failing", text: "A provider's share of failed calls in the window is above the threshold.", severity: 2 },
  { key: "privacy_request_due", label: "A privacy request is due", text: "A confirmed request is due within 7 days or overdue.", severity: 2 },
  { key: "telegram_queue", label: "The Telegram channel is backing up", text: "Messages to the Anker bot waited over ten minutes, or several failed in the last hour.", severity: 2 },
  { key: "cost_coverage", label: "AI cost records are incomplete", text: "Under 95% of the last day's AI calls have a cost, so a plan's AI allowance is not seeing the real spend.", severity: 3 },
  { key: "unpriced_model", label: "An AI model has no price", text: "Calls to a model with no price were recorded in the last day. Add the price in Model prices.", severity: 2 },
  { key: "workspace_at_limit", label: "A workspace has used its AI allowance", text: "A workspace passed 100% of its monthly AI allowance in the last day. Digest only.", severity: 3 },
] as const
export type RuleKey = (typeof RULES)[number]["key"]
export const MAX_MUTE_DAYS = 30
export const QUIET_DEFAULT = { start: 22, end: 7 }

export interface RuleView { key: string; label: string; text: string; defaultSeverity: number; enabled: boolean; severity: number | null; mutedUntil: string | null; mutedReason: string | null; threshold: Record<string, unknown>; updatedBy: string | null; resolved30: number; acted30: number; precision: number | null; lastFired: string | null; open: number }

export async function listRules(now = Date.now()): Promise<{ rules: RuleView[]; quiet: { start: number; end: number } }> {
  const set = new Map(((await sql`SELECT * FROM alert_rule_settings`) as any[]).map((r) => [String(r.rule_key), r]))
  const stats = (await sql`SELECT i.rule_key,
      count(*) FILTER (WHERE i.status = 'resolved' AND i.resolved_at > now() - interval '30 days')::int AS resolved,
      count(*) FILTER (WHERE i.status = 'resolved' AND i.resolved_at > now() - interval '30 days' AND (i.resolved_by <> 'auto' OR i.acknowledged_by IS NOT NULL OR EXISTS (SELECT 1 FROM alert_events e WHERE e.incident_id = i.id AND e.kind = 'note')))::int AS acted,
      count(*) FILTER (WHERE i.status IN ('open', 'acknowledged'))::int AS open, max(i.opened_at) AS last
    FROM alert_incidents i GROUP BY i.rule_key`) as any[]
  const by = new Map(stats.map((r) => [String(r.rule_key), r]))
  const q = set.get("quiet_hours")?.threshold ?? {}
  const qt = typeof q === "string" ? JSON.parse(q) : q
  return {
    quiet: { start: Number.isInteger(qt.start) ? qt.start : QUIET_DEFAULT.start, end: Number.isInteger(qt.end) ? qt.end : QUIET_DEFAULT.end },
    rules: RULES.map((r) => {
      const s = set.get(r.key), st = by.get(r.key)
      const resolved = Number(st?.resolved ?? 0), acted = Number(st?.acted ?? 0)
      const muted = s?.muted_until && new Date(s.muted_until).getTime() > now
      return { key: r.key, label: r.label, text: r.text, defaultSeverity: r.severity, enabled: s ? !!s.enabled : true, severity: s?.severity_override == null ? null : Number(s.severity_override),
        mutedUntil: muted ? new Date(s.muted_until).toISOString() : null, mutedReason: muted ? s.muted_reason ?? null : null, threshold: (typeof s?.threshold === "string" ? JSON.parse(s.threshold) : s?.threshold) ?? {},
        updatedBy: s?.updated_by ?? null, resolved30: resolved, acted30: acted, precision: resolved ? Math.round((100 * acted) / resolved) : null, lastFired: st?.last ? new Date(st.last).toISOString() : null, open: Number(st?.open ?? 0) }
    }),
  }
}

const reasonOf = (r: string) => { const t = (r ?? "").trim(); if (t.length < MIN_REASON) throw new ControlError(`A reason of at least ${MIN_REASON} characters is required.`); return t.slice(0, 500) }
const inRange = (v: unknown, lo: number, hi: number, what: string) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) throw new ControlError(`${what} must be between ${lo} and ${hi}.`); return n }

export interface RuleInput { key: string; enabled: boolean; severity: string; rate?: string; minCalls?: string; windowMin?: string; muteDays?: string; unmute?: boolean; reason: string }
export async function saveRule(staff: Staff, i: RuleInput, now = Date.now()): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change alert rules.", 403)
  if (!RULES.some((r) => r.key === i.key)) throw new ControlError("Unknown rule.", 404)
  const reason = reasonOf(i.reason)
  const sev = i.severity === "" || i.severity == null ? null : inRange(i.severity, 1, 3, "Severity")
  if (sev != null && !Number.isInteger(sev)) throw new ControlError("Severity must be 1, 2 or 3.")
  let threshold: Record<string, number> = {}
  if (i.key === "ai_failure_rate") {
    if (i.rate) threshold.rate = inRange(i.rate, 0.01, 1, "The failure rate")
    if (i.minCalls) threshold.minCalls = Math.floor(inRange(i.minCalls, 1, 1000, "The minimum number of calls"))
    if (i.windowMin) threshold.windowMin = Math.floor(inRange(i.windowMin, 1, 240, "The window in minutes"))
  }
  let mutedUntil: string | null | undefined
  if (i.unmute) mutedUntil = null
  else if (i.muteDays) { const d = Math.floor(inRange(i.muteDays, 1, MAX_MUTE_DAYS, "A mute")); mutedUntil = new Date(now + d * 86_400_000).toISOString() }
  const before = ((await sql`SELECT enabled, severity_override, muted_until, threshold FROM alert_rule_settings WHERE rule_key = ${i.key}`) as any[])[0]
  await sql`INSERT INTO alert_rule_settings (rule_key, enabled, severity_override, threshold, updated_by, updated_at)
    VALUES (${i.key}, ${!!i.enabled}, ${sev}, ${JSON.stringify(threshold)}::jsonb, ${staff.email}, now())
    ON CONFLICT (rule_key) DO UPDATE SET enabled = EXCLUDED.enabled, severity_override = EXCLUDED.severity_override, threshold = EXCLUDED.threshold, updated_by = EXCLUDED.updated_by, updated_at = now()`
  // A mute is changed only when asked to (set for N days, or lifted); saving the other fields leaves it alone.
  if (mutedUntil !== undefined) await sql`UPDATE alert_rule_settings SET muted_until = ${mutedUntil}::timestamptz, muted_reason = ${mutedUntil ? reason : null} WHERE rule_key = ${i.key}`
  await audit("platform.alert_rule.set", staff, i.key, { from: before ? { enabled: before.enabled, severity: before.severity_override, muted: !!before.muted_until } : null, to: { enabled: !!i.enabled, severity: sev, threshold, muteDays: i.unmute ? 0 : i.muteDays || undefined }, reason })
}

export async function saveQuiet(staff: Staff, start: string, end: string, reasonText: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change quiet hours.", 403)
  const reason = reasonOf(reasonText)
  const s = inRange(start, 0, 23, "The start hour"), e = inRange(end, 0, 23, "The end hour")
  if (!Number.isInteger(s) || !Number.isInteger(e)) throw new ControlError("Hours are whole numbers.")
  if (s === e) throw new ControlError("Start and end cannot be the same hour. Mute rules instead if you want no quiet hours.")
  await sql`INSERT INTO alert_rule_settings (rule_key, enabled, threshold, updated_by, updated_at) VALUES ('quiet_hours', true, ${JSON.stringify({ start: s, end: e })}::jsonb, ${staff.email}, now())
    ON CONFLICT (rule_key) DO UPDATE SET threshold = EXCLUDED.threshold, updated_by = EXCLUDED.updated_by, updated_at = now()`
  await audit("platform.alert_quiet.set", staff, "quiet_hours", { start: s, end: e, reason })
}
