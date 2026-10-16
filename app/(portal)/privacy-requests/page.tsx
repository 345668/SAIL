import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { listPrivacyRequests } from "@/lib/privacy-requests"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const label: Record<string, string> = { access: "Access", rectification: "Correct", erasure: "Erase", restriction: "Restrict", objection: "Object" }

export default async function PrivacyRequestsPage() {
  const staff = await getSession(); if (!staff) redirect("/login")
  let rows: Awaited<ReturnType<typeof listPrivacyRequests>> = [], error: string | null = null
  try { rows = await listPrivacyRequests(staff) } catch (e) { error = (e as Error).message }
  const open = rows.filter((r) => !r.closed_at)
  return (
    <PageShell eyebrow="Data" title="Privacy requests" description="Requests from people in the investor directory, made on an-ker.de/privacy/request. Nothing happens until the person confirms their email address. An objection is carried out at once on confirmation; the rest wait for you. The legal deadline is 30 days from receipt.">
      {error && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{error}</p>}
      <p className="mb-4 text-sm text-muted-foreground">{open.length} open · {open.filter((r) => r.overdue).length} overdue.</p>
      <section className={card}>
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">No requests yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">Kind</th><th className="pr-3 font-medium">Requester</th><th className="pr-3 font-medium">Status</th><th className="pr-3 font-medium">Due</th><th className="font-medium">Received</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-1.5 pr-3"><Link className="underline" href={`/privacy-requests/${r.id}`}>{label[r.kind] ?? r.kind}</Link></td>
                <td className="pr-3">{r.email}</td>
                <td className="pr-3">{r.status}</td>
                <td className={`pr-3 tabular-nums ${r.overdue ? "text-[var(--danger)] font-medium" : ""}`}>{r.closed_at ? "—" : r.due_at.slice(0, 10)}{r.overdue ? " overdue" : ""}</td>
                <td className="tabular-nums">{r.created_at.slice(0, 10)}</td>
              </tr>))}</tbody></table></div>
        )}
      </section>
    </PageShell>
  )
}
