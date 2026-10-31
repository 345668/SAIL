import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast } from "@/lib/tenant-control"
import { creditsOf, ADMIN_GRANT_CEILING_USD, type CreditView } from "@/lib/ai-credits"
import { creditAction } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const input = "h-8 rounded-md border border-border bg-card px-2 text-xs"
const btn = "h-8 rounded-md border border-border px-3 text-xs"
const usd = (n: number) => `$${n.toFixed(2)}`
const KIND: Record<string, string> = { grant: "Grant", debit: "Used", expiry: "Expired", adjust: "Adjustment" }

export default async function AiCreditsPage({ searchParams }: { searchParams: Promise<{ org?: string; err?: string; ok?: string }> }) {
  const { org, err, ok } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  let v: CreditView | null = null, error: string | null = null
  if (org) { try { v = await creditsOf(staff, org.trim()) } catch (e) { error = (e as Error).message } }
  return (
    <PageShell eyebrow="Platform" title="AI credits" description="Prepaid dollars that cover a workspace's AI spend beyond its monthly plan allowance. They are used soonest-expiring first and only for overage; the plan's allowance is always spent first. Amounts and dates only.">
      {(err || error) && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err ?? error}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      <form method="get" className="mb-4 flex items-center gap-2"><input name="org" defaultValue={org ?? ""} placeholder="Workspace id" aria-label="Workspace id" className={input + " w-96"} required /><button className={btn}>Open</button></form>
      {v && (
        <div className="space-y-4">
          <section className={card}>
            <h2 className="text-sm font-semibold">{v.workspace.name || v.workspace.id}</h2>
            <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Credit left</dt><dd>{usd(v.balanceUsd)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Used this month</dt><dd>{usd(v.debitedThisMonthUsd)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Plan allowance</dt><dd>{v.limitUsd === null ? "unlimited (credit is not used)" : usd(v.limitUsd)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Spent this month</dt><dd>{usd(v.spentThisMonthUsd)}</dd></div>
            </dl>
          </section>
          {admin ? <section className={card}>
            <h2 className="text-sm font-semibold">Grant or adjust</h2>
            <form action={creditAction} className="mt-3 flex flex-wrap items-center gap-2"><input type="hidden" name="org" value={v.workspace.id} /><input type="hidden" name="kind" value="grant" />
              <input name="amount" type="number" step="0.01" min="0.01" required placeholder="USD" aria-label="Amount in dollars" className={input + " w-24"} />
              <input name="days" type="number" min="1" max="3650" placeholder="expires in days (blank: never)" aria-label="Days until it expires" className={input + " w-56"} />
              <input name="reason" required minLength={5} placeholder="Why? (audited)" aria-label="Reason" className={input + " w-72"} /><button className={btn}>Grant</button></form>
            <form action={creditAction} className="mt-2 flex flex-wrap items-center gap-2"><input type="hidden" name="org" value={v.workspace.id} /><input type="hidden" name="kind" value="adjust" />
              <input name="amount" type="number" step="0.01" required placeholder="± USD" aria-label="Signed amount in dollars" className={input + " w-24"} />
              <input name="reason" required minLength={5} placeholder="Why? (a refund, a mistake; audited)" aria-label="Reason" className={input + " w-96"} /><button className={btn}>Adjust</button></form>
            <p className="mt-2 text-xs text-muted-foreground">Above ${ADMIN_GRANT_CEILING_USD} needs a superadmin. An adjustment cannot take the balance below zero. The ledger is append-only.</p>
          </section> : <p className="text-xs text-muted-foreground">Only admins can grant or adjust.</p>}
          <section className={card}>
            <h2 className="text-sm font-semibold">Ledger</h2>
            {v.ledger.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">Nothing recorded for this workspace.</p> : (
              <table className="mt-2 w-full text-left text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-1 pr-3">When</th><th className="pr-3">What</th><th className="pr-3 text-right">Amount</th><th className="pr-3">Expires</th><th>Reason</th></tr></thead>
                <tbody className="divide-y divide-border">{v.ledger.map((r) => <tr key={r.id}><td className="py-2 pr-3">{new Date(r.createdAt).toLocaleDateString("en-GB")}</td><td className="pr-3">{KIND[r.kind]}{r.period ? ` (${r.period})` : ""}</td><td className={`pr-3 text-right ${r.amountUsd < 0 ? "text-muted-foreground" : ""}`}>{r.amountUsd < 0 ? "−" : "+"}{usd(Math.abs(r.amountUsd))}</td><td className="pr-3">{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("en-GB") : "—"}</td><td className="text-xs text-muted-foreground">{r.reason ?? ""}{r.createdBy ? ` · ${r.createdBy}` : ""}</td></tr>)}</tbody></table>)}
          </section>
        </div>)}
    </PageShell>
  )
}
