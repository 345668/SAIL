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

async function call(staff: Staff, method: "GET" | "POST", body?: unknown): Promise<any> {
  const res = await forwardToAnker({ path: "admin/telegram-channel", method, body: body ? JSON.stringify(body) : undefined, contentType: body ? "application/json" : null, staffEmail: staff.email })
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
