import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast } from "@/lib/tenant-control"
import { channelStatus, devicesOf, listConnections, type ChannelStatus, type Connection, type OperatorDevice } from "@/lib/telegram-channel"
import { removeConnectionAction, revokeDeviceAction, webhookAction } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const btn = "h-8 rounded-md border border-border px-3 text-xs"

export default async function TelegramPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string; open?: string }> }) {
  const { err, ok, open } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  let s: ChannelStatus | null = null, error: string | null = null
  try { s = await channelStatus(staff) } catch (e) { error = (e as Error).message }
  let conns: Connection[] = [], devices: OperatorDevice[] = [], connError: string | null = null
  try { conns = await listConnections(staff); if (open) devices = await devicesOf(staff, open) } catch (e) { connError = (e as Error).message }
  const registered = !!s?.webhook?.url && s.webhook.url === s.webhook.expected
  return (
    <PageShell eyebrow="Platform" title="Telegram channel" description="Customers set up Telegram themselves in Anker (Connected channels): a bot for the workspace, or one of their own. This page is for supervision: what is connected, whether it is healthy, and removing a connection. It never shows a message, a token or a chat.">
      {(err || error) && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err ?? error}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {s && (
        <div className="space-y-4">
          <section className={card}>
            <h2 className="text-sm font-semibold">Set-up</h2>
            <ul className="mt-2 space-y-1 text-sm">
              <li>Shared bot (optional, <code>TELEGRAM_PRODUCT_BOT_TOKEN</code>): {s.configured || s.tokenSet ? "set" : "none. Not needed: workspaces and members connect bots of their own in Anker."}</li>
              <li>Platform secret (<code>SECRET_KEY</code>): {s.configured || s.secretKeySet ? "set" : "not set"}</li>
              <li>Bot: {s.bot ? `@${s.bot}` : s.configured ? "Telegram did not answer" : "—"}</li>
              <li>Webhook: {!s.configured ? "—" : registered ? `registered (${s.webhook!.pending} waiting at Telegram)` : s.webhook?.url ? `points elsewhere: ${s.webhook.url}` : "not registered"}{s.webhook?.lastError ? ` · Telegram's last error: ${s.webhook.lastError}` : ""}</li>
              <li>Platform switch (flag <code>telegram_channel</code>, under Flags): {s.flagOn ? "ON" : "off. Customers are told the channel is not available."}</li>
              <li>Per workspace: the feature <code>channel_telegram</code> must be in the plan, and the workspace's AI data policy must be Standard.</li>
            </ul>
            {admin && s.configured && <div className="mt-3 flex gap-2">
              <form action={webhookAction}><input type="hidden" name="action" value="register" /><button className={btn}>{registered ? "Register again" : "Register the webhook"}</button></form>
              {registered && <form action={webhookAction}><input type="hidden" name="action" value="disable" /><button className={btn}>Remove the webhook</button></form>}
            </div>}
            {!s.configured && <p className="mt-3 text-xs text-muted-foreground">There is no shared bot, which is fine. If you ever want one for every workspace, create it in @BotFather, set its token in Vercel as <code>TELEGRAM_PRODUCT_BOT_TOKEN</code>, redeploy Anker and register the webhook here.</p>}
          </section>
          <section className={card}>
            <h2 className="text-sm font-semibold">Customer connections</h2>
            <p className="mt-1 text-xs text-muted-foreground">Customers set Telegram up themselves in Anker, under Connected channels. Here you can see every workspace bot and personal bot, whether Telegram is delivering to it, how many phones are connected and recent failures, and remove a connection. You never see a message, a token or a chat.</p>
            {connError && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{connError}</p>}
            {conns.length === 0 && !connError && <p className="mt-2 text-sm text-muted-foreground">No customer has connected a bot of their own yet.</p>}
            <ul className="mt-3 divide-y divide-border">
              {conns.map((c) => (
                <li key={c.botId} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><strong>{c.orgName ?? c.orgId}</strong> · {c.scope === "personal" ? `personal bot of ${c.ownerEmail ?? "a member"}` : "workspace bot"} · @{c.username}</span>
                    <a className={btn + " inline-flex items-center"} href={`/telegram?open=${encodeURIComponent(c.botId)}`}>Devices</a>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Connected {c.connectedAt.slice(0, 10)} · devices: {c.devices.active} active, {c.devices.pending} waiting for approval{c.devices.suspended ? `, ${c.devices.suspended} paused` : ""} · last activity {c.lastActivity ? c.lastActivity.slice(0, 16).replace("T", " ") + " UTC" : "none"} · failed in the last day: {c.failed24h}</p>
                  <p className={`mt-1 text-xs ${c.webhook && !c.webhook.ok ? "text-[var(--danger)]" : "text-muted-foreground"}`}>Telegram delivery: {c.webhook == null ? "not checked" : c.webhook.ok ? `healthy (${c.webhook.pending} waiting)` : `problem: ${c.webhook.lastError ?? "webhook not registered"}`}</p>
                  {open === c.botId && (
                    <div className="mt-2 rounded-md border border-border p-3">
                      <p className="text-xs font-medium">Devices on this bot</p>
                      <ul className="mt-1 space-y-1">{devices.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span>{d.userEmail ?? "a member"}{d.telegramUsername ? ` (@${d.telegramUsername})` : ""} · {d.status} · {d.mode === "write" ? "may propose changes" : "read-only"} · linked {d.linkedAt.slice(0, 10)}</span>
                          {admin && <form action={revokeDeviceAction} className="flex gap-1"><input type="hidden" name="linkId" value={d.id} /><input name="reason" required minLength={5} placeholder="reason (shown to the owner)" aria-label="Reason" className="h-7 w-48 rounded-md border border-border bg-card px-2" /><button className={btn}>Disconnect</button></form>}
                        </li>))}
                        {devices.length === 0 && <li className="text-xs text-muted-foreground">No devices.</li>}</ul>
                    </div>)}
                  {admin && (
                    <form action={removeConnectionAction} className="mt-2 flex flex-wrap items-center gap-2">
                      <input type="hidden" name="botId" value={c.botId} />
                      <input name="reason" required minLength={5} placeholder="Why remove this connection? The owners are shown it." aria-label="Reason for removing" className="h-8 w-80 rounded-md border border-border bg-card px-2 text-xs" />
                      <button className={btn}>Remove the connection</button>
                    </form>)}
                </li>))}
            </ul>
          </section>
          <section className={card}>
            <h2 className="text-sm font-semibold">Queue, last day</h2>
            <p className="mt-1 text-sm">{s.queue.length ? s.queue.map((q) => `${q.n} ${q.status}${q.oldest ? ` (oldest ${q.oldest.slice(11, 16)} UTC)` : ""}`).join(" · ") : "Nothing waiting or failed."}</p>
          </section>
          <section className={card}>
            <h2 className="text-sm font-semibold">Connected devices</h2>
            <p className="mt-1 text-sm">{s.links.length ? s.links.map((l) => `${l.n} ${l.status} in ${l.workspaces} workspace${l.workspaces === 1 ? "" : "s"}`).join(" · ") : "None yet."}</p>
          </section>
        </div>
      )}
    </PageShell>
  )
}
