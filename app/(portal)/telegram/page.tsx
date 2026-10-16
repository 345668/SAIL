import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast } from "@/lib/tenant-control"
import { channelStatus, type ChannelStatus } from "@/lib/telegram-channel"
import { webhookAction } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const btn = "h-8 rounded-md border border-border px-3 text-xs"

export default async function TelegramPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  let s: ChannelStatus | null = null, error: string | null = null
  try { s = await channelStatus(staff) } catch (e) { error = (e as Error).message }
  const registered = !!s?.webhook?.url && s.webhook.url === s.webhook.expected
  return (
    <PageShell eyebrow="Platform" title="Telegram channel" description="Customers connect their own Telegram account to a workspace and ask Anker AI from their phone. This page shows whether the bot is set up and healthy. It never shows a message or a secret.">
      {(err || error) && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err ?? error}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {s && (
        <div className="space-y-4">
          <section className={card}>
            <h2 className="text-sm font-semibold">Set-up</h2>
            <ul className="mt-2 space-y-1 text-sm">
              <li>Shared bot token (<code>TELEGRAM_PRODUCT_BOT_TOKEN</code>, optional): {s.configured || s.tokenSet ? "set" : "not set. Workspaces can connect a bot of their own in Anker, Connected channels; no Vercel step is needed for that."}</li>
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
            {!s.configured && <p className="mt-3 text-xs text-muted-foreground">Create the bot in Telegram with @BotFather, set its token in Vercel as <code>TELEGRAM_PRODUCT_BOT_TOKEN</code>, redeploy Anker, and come back to register the webhook.</p>}
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
