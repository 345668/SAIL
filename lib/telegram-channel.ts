import { forwardToAnker } from "./anker-proxy"
import { audit } from "./audit"
import { ControlError, roleAtLeast } from "./tenant-control"
import type { Staff } from "./studio-credits"

/** The customer Telegram channel, operator side (Anker docs/architecture/57, T1). Status and webhook set-up only. SAIL never sees a customer's message or any secret. */
export interface ChannelStatus {
  configured: boolean; tokenSet?: boolean; secretKeySet?: boolean; flagOn: boolean; bot?: string | null; error?: string | null
  webhook?: { url: string | null; expected: string; pending: number; lastError: string | null } | null
  queue: { status: string; n: number; oldest: string | null }[]; links: { status: string; n: number; workspaces: number }[]
}

async function call(staff: Staff, method: "GET" | "POST", body?: unknown, search?: string): Promise<any> {
  const res = await forwardToAnker({ path: "admin/telegram-channel", method, search, body: body ? JSON.stringify(body) : undefined, contentType: body ? "application/json" : null, staffEmail: staff.email })
  const json: any = await res.json().catch(() => ({}))
  if (!res.ok) throw new ControlError(String(json?.error ?? `The app answered ${res.status}.`), res.status >= 500 ? 502 : 400)
  return json
}
export async function channelStatus(staff: Staff): Promise<ChannelStatus> { return call(staff, "GET") }

export async function setWebhook(staff: Staff, action: "register" | "disable"): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can change the Telegram webhook.", 403)
  if (action !== "register" && action !== "disable") throw new ControlError("Unknown action.")
  await call(staff, "POST", { action })
  await audit(`platform.telegram_webhook.${action}`, staff, null, {})
}

// Supervision (the setup is done by customers in Anker; the operator sees counts and can remove, never reads a message).
export interface Connection {
  botId: string; orgId: string; orgName: string | null; scope: "workspace" | "personal"; ownerEmail: string | null; username: string; connectedAt: string
  devices: { active: number; pending: number; suspended: number }; lastActivity: string | null; failed24h: number
  webhook?: { ok: boolean; pending: number; lastError: string | null } | null
}
export interface OperatorDevice { id: string; orgId: string; orgName: string | null; userEmail: string | null; telegramUsername: string | null; status: string; mode: string; linkedAt: string; lastSeenAt: string | null }
export async function listConnections(staff: Staff, check = true): Promise<Connection[]> { return (await call(staff, "GET", undefined, `?connections=1${check ? "&check=1" : ""}`)).connections ?? [] }
export async function devicesOf(staff: Staff, botId: string): Promise<OperatorDevice[]> { return (await call(staff, "GET", undefined, `?devices=${encodeURIComponent(botId)}`)).devices ?? [] }

const need = (reason: string) => { const r = reason.replace(/\s+/g, " ").trim(); if (r.length < 5) throw new ControlError("Give a reason of at least a few words: the workspace owners are shown it."); return r }
export async function removeConnection(staff: Staff, botId: string, reason: string): Promise<number> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can remove a customer's connection.", 403)
  const r = need(reason)
  const j = await call(staff, "POST", { action: "disconnect_bot", botId, reason: r })
  await audit("platform.telegram_connection.remove", staff, botId, { reason: r, devices: j.devices })
  return Number(j.devices ?? 0)
}
export async function revokeDevice(staff: Staff, linkId: string, reason: string): Promise<void> {
  if (!roleAtLeast(staff.role, "admin")) throw new ControlError("Only admins can disconnect a customer's device.", 403)
  const r = need(reason)
  await call(staff, "POST", { action: "revoke_link", linkId, reason: r })
  await audit("platform.telegram_device.revoke", staff, linkId, { reason: r })
}
