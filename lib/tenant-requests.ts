import { forwardToAnker } from "./anker-proxy"
import { audit } from "./audit"
import { ControlError, roleAtLeast, type Role } from "./tenant-control"

/**
 * Export and erasure requests, as SAIL sees them (Anker docs/architecture/41 §6). SAIL decides WHO may ask and demands a fresh two-factor code for
 * the destructive step; Anker holds the registry, does the work, and re-checks everything about the data. SAIL never receives tenant content:
 * only status, counts and table names come back.
 */
type Staff = { id: string; email: string; role: Role }
export type RequestRow = { id: string; kind: "export" | "erasure"; status: string; requested_by: string | null; approved_by: string | null; deadline_at: string | null; execute_after: string | null; created_at: string; detail: any }

/** Workspace ids are letters, numbers, colon, underscore and hyphen (for example onboarding:vc:<uuid>). Anything else is refused before it reaches a URL. */
const path = (org: string) => {
  if (!/^[A-Za-z0-9:_-]{1,120}$/.test(org)) throw new ControlError("That is not a workspace id.", 400)
  return `admin/tenants/${org}/requests`
}

async function call(staff: Staff, org: string, method: "GET" | "POST", body?: unknown): Promise<any> {
  const res = await forwardToAnker({ path: path(org), method, body: body ? JSON.stringify(body) : undefined, contentType: body ? "application/json" : null, staffEmail: staff.email })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The tenant app answered ${res.status}.`), res.status >= 500 ? 502 : res.status === 404 ? 404 : 400)
  return json
}

export async function listTenantRequests(staff: Staff, org: string): Promise<RequestRow[]> { return (await call(staff, org, "GET")).requests ?? [] }

export async function requestExport(staff: Staff, org: string): Promise<{ id: string; tables: number; bytes: number }> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can request an export.", 403)
  const out = await call(staff, org, "POST", { action: "export" })
  await audit("tenant.export.request", staff, org, { requestId: out.id, tables: out.tables, bytes: out.bytes })
  return out
}

export async function requestDryRun(staff: Staff, org: string) {
  if (!roleAtLeast(staff.role, "superadmin")) throw new ControlError("Only a superadmin can start an erasure.", 403)
  const out = await call(staff, org, "POST", { action: "dry_run" })
  await audit("tenant.erasure.dry_run", staff, org, { requestId: out.id, toDelete: out.dryRun?.toDelete, blockers: (out.blockers ?? []).map((b: any) => b.code) })
  return out
}

/** The caller must already have passed the step-up check. The typed name is verified here and again by the tenant app. */
export async function scheduleErasure(staff: Staff, org: string, requestId: string, confirmName: string) {
  if (!roleAtLeast(staff.role, "superadmin")) throw new ControlError("Only a superadmin can schedule an erasure.", 403)
  const out = await call(staff, org, "POST", { action: "schedule", requestId, confirmName })
  await audit("tenant.erasure.schedule", staff, org, { requestId, executeAfter: out.executeAfter })
  return out
}

export async function cancelTenantRequest(staff: Staff, org: string, requestId: string) {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can cancel a request.", 403)
  await call(staff, org, "POST", { action: "cancel", requestId })
  await audit("tenant.request.cancel", staff, org, { requestId })
}
