import { forwardToAnker } from "./anker-proxy"
import { ControlError } from "./tenant-control"
import type { Staff } from "./studio-credits"

/** The restore drills, operator side (Anker docs/architecture/59 R4). Dates, counts and the per-table comparison: no row content exists in what the app returns. The drill itself is run by the founder in a terminal (docs/runbooks/restore.md); SAIL only shows it. */
export interface DrillRow { startedAt: string; ageMin: number; seconds: number | null; passed: boolean; tablesChecked: number; tablesOff: number; error: string | null; branchDeleted: boolean | null; offTables: Array<{ table: string; production: number; restored: number; expected: number }> }
export interface DrillOverview { drills: DrillRow[]; lastPassedAt: string | null; overdueAfterDays: number }
export async function drillOverview(staff: Staff): Promise<DrillOverview> {
  const res = await forwardToAnker({ path: "admin/restore-drill", method: "GET", staffEmail: staff.email } as any)
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status >= 500 ? 502 : 400)
  return json
}
export const daysSince = (iso: string | null, now = Date.now()) => (iso ? Math.floor((now - new Date(iso).getTime()) / 86_400_000) : null)
