import { forwardToAnker } from "./anker-proxy"
import { audit } from "./audit"
import { ControlError, roleAtLeast, setFlag } from "./tenant-control"
import type { Staff } from "./studio-credits"

/** Halyard, operator side (Anker docs/architecture/62 section 15). Counts, timings and health per workspace, and the platform kill switch. SAIL never sees a transcript, a title, a note or a suggestion: Anker's route does not return them. */
export interface HalyardOverview {
  flagOn: boolean
  health: { windowMin: number; suggestions: number; p50Ms: number | null; p95Ms: number | null; uploads: number; failed: number; failureRate: number | null }
  totals: { sessions30d: number; liveNow: number; minutes30d: number; suggestions30d: number }
  workspaces: Array<{ orgId: string; orgName: string | null; sessions30d: number; minutes30d: number; suggestions30d: number; liveNow: number; featureOverride: boolean | null; retentionMonths: number }>
}
export async function halyardOverview(staff: Staff): Promise<HalyardOverview> {
  const res = await forwardToAnker({ path: "admin/halyard", method: "GET", staffEmail: staff.email } as any)
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status >= 500 ? 502 : 400)
  return json
}

/** Switching Halyard off for everyone (and back on). Live sessions stop at once; people can still read, export and delete their calls. A reason is required and audited by setFlag. */
export async function setHalyardSwitch(staff: Staff, on: boolean, reason: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can switch Halyard on or off.", 403)
  await setFlag(staff, { key: "halyard_web", enabled: on, rolloutPct: 100, reason })
  await audit(`platform.halyard.${on ? "on" : "off"}`, staff, "halyard_web", { reason: reason.trim().slice(0, 300) })
}
