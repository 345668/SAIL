import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast } from "@/lib/tenant-control"
import { listPricesAndUnits, type PriceRow, type UnitPriceRow } from "@/lib/model-prices"
import { savePriceAction, saveUnitPriceAction } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const input = "h-8 w-24 rounded-md border border-border bg-card px-2 text-xs"
const btn = "h-8 rounded-md border border-border px-3 text-xs"

export default async function ModelPricesPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  let rows: PriceRow[] = [], units: UnitPriceRow[] = [], error: string | null = null
  try { ({ prices: rows, units } = await listPricesAndUnits(staff)) } catch (e) { error = (e as Error).message }
  const missing = rows.filter((r) => r.source === "none" && r.calls30d > 0)
  return (
    <PageShell eyebrow="Platform" title="Model prices" description="List price of each AI model in US dollars per million tokens. A workspace's monthly AI allowance adds up these prices, so a model without one is not counted at all. Prices here are list prices, whichever lane served the call. Prices marked unverified are placeholders: check them against the provider's price list.">
      {(err || error) && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err ?? error}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {missing.length > 0 && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm">{missing.length} model(s) in use have no price: {missing.map((m) => `${m.model} (${m.calls30d} calls)`).join(", ")}.</p>}
      <section className={card}>
        <table className="w-full text-left text-sm">
          <thead><tr className="text-xs text-muted-foreground"><th className="py-1">Model</th><th>Calls, 30 days</th><th>Unpriced</th><th>Price in / out</th><th>From</th><th>Verified</th>{admin && <th>Set price</th>}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className="border-t border-border align-top">
                <td className="py-2 font-mono text-xs">{r.model}</td>
                <td>{r.calls30d}</td>
                <td>{r.unpriced30d || "—"}</td>
                <td>{r.priceIn == null ? "none" : `${r.priceIn} / ${r.priceOut}`}</td>
                <td className="text-xs">{r.source === "table" ? "this list" : r.source === "catalog" ? "catalogue" : "—"}{r.note ? <div className="text-muted-foreground">{r.note}</div> : null}</td>
                <td>{r.source === "table" ? (r.verified ? "yes" : "no") : "—"}</td>
                {admin && (
                  <td>
                    <form action={savePriceAction} className="flex flex-wrap items-center gap-1">
                      <input type="hidden" name="model" value={r.model} />
                      <input className={input} name="priceIn" placeholder="in" defaultValue={r.priceIn ?? ""} aria-label={`Input price for ${r.model}`} />
                      <input className={input} name="priceOut" placeholder="out" defaultValue={r.priceOut ?? ""} aria-label={`Output price for ${r.model}`} />
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="verified" defaultChecked={r.verified} />checked</label>
                      <input className={`${input} w-32`} name="note" placeholder="note" defaultValue={r.source === "table" ? r.note ?? "" : ""} />
                      <button className={btn}>Save</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && !error && <p className="text-sm text-muted-foreground">No AI calls in the last 30 days.</p>}
        {admin && (
          <form action={savePriceAction} className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <span className="text-xs font-medium">Add a model</span>
            <input className={`${input} w-48`} name="model" placeholder="model id" aria-label="Model id" />
            <input className={input} name="priceIn" placeholder="in / 1M" aria-label="Input price" />
            <input className={input} name="priceOut" placeholder="out / 1M" aria-label="Output price" />
            <input className={`${input} w-40`} name="note" placeholder="note" />
            <button className={btn}>Add</button>
          </form>
        )}
      </section>
      <section className={`${card} mt-4`}>
        <h2 className="text-sm font-semibold">Other metered units</h2>
        <p className="mb-2 text-xs text-muted-foreground">Speech, embeddings, document reading and generated media are not priced per token. Each is a price in US dollars for one unit. Unverified prices are placeholders: check them against the provider's price list.</p>
        <table className="w-full text-left text-sm">
          <thead><tr className="text-xs text-muted-foreground"><th className="py-1">Unit</th><th>Events, 30 days</th><th>Quantity</th><th>Cost</th><th>Price per unit</th><th>Verified</th>{admin && <th>Set price</th>}</tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.unit} className="border-t border-border align-top">
                <td className="py-2 font-mono text-xs">{u.unit}<div className="font-sans text-muted-foreground">{u.note}</div></td>
                <td>{u.events30d}</td><td>{Math.round(u.qty30d).toLocaleString()}</td><td>${u.usd30d.toFixed(4)}</td><td>{u.priceUsd}</td><td>{u.verified ? "yes" : "no"}</td>
                {admin && (
                  <td>
                    <form action={saveUnitPriceAction} className="flex flex-wrap items-center gap-1">
                      <input type="hidden" name="unit" value={u.unit} />
                      <input className={input} name="priceUsd" defaultValue={u.priceUsd} aria-label={`Price per unit for ${u.unit}`} />
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="verified" defaultChecked={u.verified} />checked</label>
                      <input className={`${input} w-32`} name="note" placeholder="note" defaultValue={u.note ?? ""} />
                      <button className={btn}>Save</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </PageShell>
  )
}
