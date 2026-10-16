import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { listSubprocessors, REGIONS } from "@/lib/data-policy"
import { save } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const f = "rounded-md border border-border bg-card px-2 py-1 text-xs"

export default async function SubprocessorsPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  const rows = await listSubprocessors()
  return (
    <PageShell eyebrow="Governance" title="Sub-processors" description="The companies that process data for Anker. This register drives the public page at an-ker.de/privacy/subprocessors and the region rules of each workspace's AI data policy. Nothing is marked confirmed, signed or opted out until someone has checked it with the provider and recorded the date.">
      {err && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {!admin && <p className="mb-4 text-sm text-muted-foreground">You can read this. Changing it needs an admin.</p>}
      <div className="space-y-4">{rows.map((r) => (
        <section key={r.slug} className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-sm font-semibold">{r.provider} <span className="text-xs font-normal text-muted-foreground">({r.role.replace("_", " ")})</span></h2>
            <p className="text-xs">{r.active ? "in use" : "not in use"} · {r.public ? "shown publicly" : "not shown"} · region {r.region} ({r.region_basis}) · agreement {r.dpa_status} · training opt-out {r.training_opt_out}</p></div>
          <p className="mt-1 text-xs text-muted-foreground">{r.purpose}{r.last_verified ? ` · checked ${r.last_verified}` : " · never checked with the provider"}{r.notes ? ` · ${r.notes}` : ""}</p>
          {admin && <details className="mt-3"><summary className="cursor-pointer text-xs underline">Edit</summary>
            <form action={save} className="mt-3 grid gap-2 sm:grid-cols-2"><input type="hidden" name="slug" value={r.slug} />
              <label className="text-xs sm:col-span-2">What it is used for<input name="purpose" defaultValue={r.purpose} required maxLength={300} className={`${f} mt-1 block w-full`} /></label>
              <label className="text-xs">Region<select name="region" defaultValue={r.region} className={`${f} mt-1 block w-full`}>{REGIONS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="text-xs">Region basis<select name="region_basis" defaultValue={r.region_basis} className={`${f} mt-1 block w-full`}><option value="inferred">inferred from configuration</option><option value="confirmed">confirmed with the provider</option></select></label>
              <label className="text-xs">Agreement (DPA)<select name="dpa_status" defaultValue={r.dpa_status} className={`${f} mt-1 block w-full`}><option>unverified</option><option>requested</option><option>signed</option></select></label>
              <label className="text-xs">No training on our data<select name="training_opt_out" defaultValue={r.training_opt_out} className={`${f} mt-1 block w-full`}><option>unverified</option><option>yes</option><option>no</option></select></label>
              <label className="text-xs">Retention<input name="retention" defaultValue={r.retention ?? ""} maxLength={200} className={`${f} mt-1 block w-full`} /></label>
              <label className="text-xs">Terms link (https)<input name="terms_url" defaultValue={r.terms_url ?? ""} maxLength={300} className={`${f} mt-1 block w-full`} /></label>
              <label className="text-xs">Last checked with the provider<input type="date" name="last_verified" defaultValue={r.last_verified ?? ""} className={`${f} mt-1 block w-full`} /></label>
              <label className="text-xs">Data it receives (comma separated)<input name="data_classes" defaultValue={r.data_classes.join(", ")} maxLength={300} className={`${f} mt-1 block w-full`} /></label>
              <label className="text-xs sm:col-span-2">Notes<input name="notes" defaultValue={r.notes ?? ""} maxLength={500} className={`${f} mt-1 block w-full`} /></label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={r.active} /> in use today</label>
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="public" defaultChecked={r.public} /> show on the public page</label>
              <label className="text-xs sm:col-span-2">Reason for this change<input name="reason" required minLength={MIN_REASON} maxLength={500} className={`${f} mt-1 block w-full`} placeholder="e.g. DPA received from the provider, 2026-10-20" /></label>
              <div className="sm:col-span-2"><button className="h-8 rounded-md border border-border px-3 text-xs">Save</button></div>
            </form></details>}
        </section>))}</div>
    </PageShell>
  )
}
