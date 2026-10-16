import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { listSources, PURPOSES, KINDS, WITHDRAW_ADMIN_CEILING } from "@/lib/directory-sources"
import { review, withdraw, restore } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const field = "rounded-md border border-border bg-card px-2 py-1 text-xs"
const badge: Record<string, string> = { recorded: "text-[var(--success)]", unreviewed: "text-[var(--warning)]", restricted: "text-[var(--warning)]", withdrawn: "text-[var(--danger)]" }

export default async function DirectorySourcesPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { err, ok } = await searchParams
  const staff = await getSession()
  if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  const sources = await listSources()
  const unreviewed = sources.filter((s) => s.status === "unreviewed")
  return (
    <PageShell eyebrow="Data" title="Directory sources" description="Where each group of investors and firms in the shared directory came from, and what it may be used for. A restricted or withdrawn source is blocked in Anker at once. An unreviewed source can be used for matching only; outreach to it is logged as a warning until the use gate is switched on. Imports are refused for a source that is not listed here.">
      {err && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {!admin && <p className="mb-4 text-sm text-muted-foreground">You can read this. Changing a source needs an admin.</p>}
      <p className="mb-4 text-sm text-muted-foreground">{sources.length} sources · {unreviewed.length} not yet reviewed ({unreviewed.reduce((a, s) => a + s.people, 0).toLocaleString()} people).</p>
      <div className="space-y-4">
        {sources.map((s) => (
          <section key={s.source} className={card}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold break-all">{s.label && s.label !== s.source ? `${s.label} ` : ""}<code className="text-xs font-normal">{s.source}</code></h2>
              <p className="text-xs"><span className={`font-medium ${badge[s.status] ?? ""}`}>{s.status}</span> · {s.people.toLocaleString()} people · {s.firms.toLocaleString()} firms</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">May be used for: {s.status === "withdrawn" ? "nothing (withdrawn)" : s.permitted_use.map((u) => PURPOSES.find(([k]) => k === u)?.[1] ?? u).join(", ") || "nothing"}{s.licence_summary ? ` · Licence: ${s.licence_summary}` : " · No licence recorded"}{s.forbidden_use ? ` · Not allowed: ${s.forbidden_use}` : ""}{s.withdraw_reason ? ` · Withdrawn because: ${s.withdraw_reason}` : ""}{s.purge_on ? ` · People hidden now; deleted on ${s.purge_on} unless restored` : ""}{s.purged_at ? ` · People deleted on ${s.purged_at}` : ""}</p>
            {admin && s.status !== "withdrawn" && (
              <details className="mt-3"><summary className="cursor-pointer text-xs underline">Review or edit</summary>
                <form action={review} className="mt-3 grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="source" value={s.source} />
                  <label className="text-xs">Status<select name="status" defaultValue={s.status} className={`${field} mt-1 block w-full`}><option value="recorded">recorded (licence known)</option><option value="restricted">restricted (limited use)</option><option value="unreviewed">unreviewed</option></select></label>
                  <label className="text-xs">Kind<select name="kind" defaultValue={s.kind} className={`${field} mt-1 block w-full`}>{KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select></label>
                  <label className="text-xs">Label<input name="label" defaultValue={s.label ?? ""} maxLength={200} className={`${field} mt-1 block w-full`} /></label>
                  <label className="text-xs">Supplier<input name="supplier" defaultValue={s.supplier ?? ""} maxLength={200} className={`${field} mt-1 block w-full`} /></label>
                  <label className="text-xs">Acquired<input type="date" name="acquired_at" defaultValue={s.acquired_at ?? ""} className={`${field} mt-1 block w-full`} /></label>
                  <fieldset className="text-xs"><legend>Permitted use</legend>{PURPOSES.map(([k, l]) => <label key={k} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" name="permitted_use" value={k} defaultChecked={s.permitted_use.includes(k)} /> {l}</label>)}</fieldset>
                  <label className="text-xs sm:col-span-2">Licence summary (what the supplier's terms say)<textarea name="licence_summary" defaultValue={s.licence_summary ?? ""} rows={2} maxLength={1000} className={`${field} mt-1 block w-full`} /></label>
                  <label className="text-xs sm:col-span-2">Not allowed (required when restricted)<input name="forbidden_use" defaultValue={s.forbidden_use ?? ""} maxLength={500} className={`${field} mt-1 block w-full`} /></label>
                  <label className="text-xs sm:col-span-2">Lawful-basis note<input name="lawful_basis_note" defaultValue={s.lawful_basis_note ?? ""} maxLength={500} className={`${field} mt-1 block w-full`} /></label>
                  <label className="text-xs sm:col-span-2">Reason for this change<input name="reason" required minLength={MIN_REASON} maxLength={500} placeholder="e.g. Supplier contract reviewed, outreach permitted" className={`${field} mt-1 block w-full`} /></label>
                  <div className="sm:col-span-2"><button className="h-8 rounded-md border border-border px-3 text-xs">Save review</button></div>
                </form>
                <form action={withdraw} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <input type="hidden" name="source" value={s.source} />
                  <label className="min-w-[240px] flex-1 text-xs">Withdraw this source (hides and blocks everyone at once, deleted after 30 days{s.people > WITHDRAW_ADMIN_CEILING ? `; over ${WITHDRAW_ADMIN_CEILING.toLocaleString()} people needs a superadmin` : ""})<input name="reason" required minLength={MIN_REASON} maxLength={500} placeholder="Why, e.g. the supplier asked us to remove it" className={`${field} mt-1 block w-full`} /></label>
                  <button className="h-8 rounded-md border border-[var(--danger)] px-3 text-xs text-[var(--danger)]">Withdraw {s.people.toLocaleString()} people</button>
                </form>
              </details>
            )}
            {admin && s.status === "withdrawn" && !s.purged_at && (
              <form action={restore} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="source" value={s.source} />
                <label className="min-w-[240px] flex-1 text-xs">Restore as unreviewed<input name="reason" required minLength={MIN_REASON} maxLength={500} placeholder="Why" className={`${field} mt-1 block w-full`} /></label>
                <button className="h-8 rounded-md border border-border px-3 text-xs">Restore</button></form>
            )}
          </section>
        ))}
      </div>
      {admin && (
        <section className={`${card} mt-6`}>
          <h2 className="text-sm font-semibold">Register a new source</h2>
          <p className="mt-1 text-xs text-muted-foreground">Do this before an import: the importer refuses a source that is not listed. Use the same key you will give the import (for example <code>csv:partner-list-2026</code>).</p>
          <form action={review} className="mt-3 grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="status" value="recorded" />
            <label className="text-xs">Source key<input name="source" required maxLength={200} className={`${field} mt-1 block w-full`} /></label>
            <label className="text-xs">Kind<select name="kind" defaultValue="partner_list" className={`${field} mt-1 block w-full`}>{KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}</select></label>
            <label className="text-xs">Label<input name="label" maxLength={200} className={`${field} mt-1 block w-full`} /></label>
            <label className="text-xs">Supplier<input name="supplier" maxLength={200} className={`${field} mt-1 block w-full`} /></label>
            <label className="text-xs">Acquired<input type="date" name="acquired_at" className={`${field} mt-1 block w-full`} /></label>
            <fieldset className="text-xs"><legend>Permitted use</legend>{PURPOSES.map(([k, l]) => <label key={k} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" name="permitted_use" value={k} defaultChecked={k === "internal_matching"} /> {l}</label>)}</fieldset>
            <label className="text-xs sm:col-span-2">Licence summary<textarea name="licence_summary" required rows={2} maxLength={1000} className={`${field} mt-1 block w-full`} /></label>
            <label className="text-xs sm:col-span-2">Not allowed<input name="forbidden_use" maxLength={500} className={`${field} mt-1 block w-full`} /></label>
            <label className="text-xs sm:col-span-2">Lawful-basis note<input name="lawful_basis_note" maxLength={500} className={`${field} mt-1 block w-full`} /></label>
            <label className="text-xs sm:col-span-2">Reason<input name="reason" required minLength={MIN_REASON} maxLength={500} placeholder="e.g. Partner list received 2026-10-20 under written agreement" className={`${field} mt-1 block w-full`} /></label>
            <div className="sm:col-span-2"><button className="h-8 rounded-md border border-border px-3 text-xs">Register source</button></div>
          </form>
        </section>
      )}
    </PageShell>
  )
}
