import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { listRates } from "@/lib/studio-credits"
import { updateRate } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const small = "rounded-md border border-border bg-card px-2 py-1 text-xs"

export default async function RatesPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams
  const staff = await getSession()
  if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  const rates = await listRates()
  return (
    <PageShell eyebrow="Governance" title="Studio price list" description="What each generation costs in credits (1 credit is about $0.001 of provider cost). Images cost per request; video costs per second at its resolution. Compare with the provider's invoices and correct a price here. Turning a price off makes that model unavailable to generate.">
      <p className="mb-4 text-sm"><Link className="underline" href="/organizations">← Organizations</Link> · open a workspace, then Studio credits, to grant or take back credits.</p>
      {err && <p className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {!admin && <p className="mb-4 text-sm text-muted-foreground">You can read this. Changing a price needs an admin.</p>}
      <section className={card}>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs text-muted-foreground"><th className="py-1 pr-3 font-medium">Model</th><th className="pr-3 font-medium">Resolution</th><th className="pr-3 font-medium">Per</th><th className="pr-3 font-medium">Credits</th><th className="pr-3 font-medium">On</th>{admin && <th className="font-medium">Reason and save</th>}</tr></thead>
          <tbody>{rates.map((r) => (
            <tr key={`${r.model}|${r.resolution}`} className="border-t border-border align-middle">
              <td className="py-1.5 pr-3">{r.model}</td><td className="pr-3">{r.resolution === "*" ? "any" : r.resolution}</td><td className="pr-3">{r.unit === "second" ? "second" : "request"}</td>
              {admin ? (
                <td colSpan={3} className="pr-3"><form action={updateRate} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="model" value={r.model} /><input type="hidden" name="resolution" value={r.resolution} />
                  <input type="number" name="credits" min={1} step={1} required defaultValue={r.credits} className={`${small} w-20`} aria-label={`Credits for ${r.model}`} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={r.active} /> on</label>
                  <input name="reason" required minLength={MIN_REASON} maxLength={500} placeholder="Why, e.g. the invoice shows more" className={`${small} min-w-[220px] flex-1`} />
                  <button className="h-7 rounded-md border border-border px-3 text-xs">Save</button></form></td>
              ) : (<><td className="pr-3 tabular-nums">{r.credits}</td><td className="pr-3">{r.active ? "yes" : "no"}</td></>)}
            </tr>))}</tbody></table></div>
      </section>
    </PageShell>
  )
}
