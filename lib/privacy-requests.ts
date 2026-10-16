import { forwardToAnker } from "./anker-proxy"
import { audit } from "./audit"
import { ControlError, roleAtLeast, type Role } from "./tenant-control"

/**
 * Privacy requests from people in the shared investor directory, as SAIL sees them (Anker docs/architecture/54, D3). Anker holds the encrypted details and does the work; SAIL
 * decides who may act and writes the audit entry. The audit never contains the requester's address or any record content, only the request id, kind and counts.
 */
type Staff = { id: string; email: string; role: Role }
export type RequestSummary = { id: string; kind: string; status: string; email: string; created_at: string; due_at: string; verified_at: string | null; closed_at: string | null; overdue: boolean; outcome: any }
export type Person = { id: string; first_name: string; last_name: string | null; title: string | null; email: string | null; linkedin_url: string | null; person_linkedin_url: string | null; source: string | null; restricted_at: string | null; is_active: boolean | null }
export type RequestDetail = { request: any; details: { email: string; linkedin: string | null; note: string | null } | null; found: { byEmail: Person[]; byLinkedIn: Person[] } }

const ID = /^[0-9a-f-]{36}$/i
async function call(staff: Staff, path: string, method: "GET" | "POST", body?: unknown): Promise<any> {
  const res = await forwardToAnker({ path, method, body: body ? JSON.stringify(body) : undefined, contentType: body ? "application/json" : null, staffEmail: staff.email })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status === 501 ? 501 : res.status >= 500 ? 502 : res.status === 404 ? 404 : 400)
  return json
}

export async function listPrivacyRequests(staff: Staff): Promise<RequestSummary[]> { return (await call(staff, "admin/privacy-requests", "GET")).requests ?? [] }
export async function getPrivacyRequest(staff: Staff, id: string): Promise<RequestDetail> {
  if (!ID.test(id)) throw new ControlError("Unknown request.", 404)
  return call(staff, `admin/privacy-requests/${id}`, "GET")
}

export type Action = { action: "access" | "rectify" | "restrict" | "refuse" | "extend" | "erase"; ids?: string[]; changes?: Record<string, string>; reason?: string; days?: number }
export async function actOnPrivacyRequest(staff: Staff, id: string, a: Action): Promise<any> {
  if (!ID.test(id)) throw new ControlError("Unknown request.", 404)
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can act on a privacy request.", 403)
  if (a.action === "erase" && !roleAtLeast(staff.role, "superadmin")) throw new ControlError("Only a superadmin can erase.", 403)
  if ((a.action === "refuse" || a.action === "extend") && (a.reason ?? "").trim().length < 10) throw new ControlError("A reason of at least 10 characters is required.")
  const out = await call(staff, `admin/privacy-requests/${id}`, "POST", a)
  await audit(`platform.privacy_request.${a.action}`, staff, id, { rows: out?.rows ?? null, ids: a.ids?.length ?? 0, fields: a.changes ? Object.keys(a.changes) : undefined, days: a.days })
  return out
}
