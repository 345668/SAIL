import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast } from "@/lib/tenant-control"
import { getPrivacyRequest, previewErasure, type ErasePreview, type Person } from "@/lib/privacy-requests"
import { act } from "../actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const field = "rounded-md border border-border bg-card px-2 py-1 text-xs"
const btn = "h-8 rounded-md border border-border px-3 text-xs"

function People({ title, people, pick }: { title: string; people: Person[]; pick: boolean }) {
  if (!people.length) return null
  return (
    <div className="mt-3"><h3 className="text-xs font-semibold">{title}</h3>
      <div className="overflow-x-auto"><table className="mt-1 w-full text-left text-xs"><tbody>{people.map((p) => (
        <tr key={p.id} className="border-t border-border">
          {pick && <td className="py-1 pr-2"><input type="checkbox" form="actform" name="ids" value={p.id} aria-label={`Include ${p.first_name} ${p.last_name ?? ""}`} /></td>}
          <td className="py-1 pr-3">{p.first_name} {p.last_name}</td><td className="pr-3">{p.title}</td><td className="pr-3">{p.email}</td><td className="pr-3 break-all">{p.person_linkedin_url || p.linkedin_url}</td><td className="pr-3">{p.source}</td><td>{p.restricted_at ? "restricted" : p.is_active === false ? "inactive" : ""}</td>
        </tr>))}</tbody></table></div></div>
  )
}

export default async function PrivacyRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; ok?: string }> }) {
  const [{ id }, { err, ok }] = await Promise.all([params, searchParams])
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  let d: Awaited<ReturnType<typeof getPrivacyRequest>> | null = null, error: string | null = null
  try { d = await getPrivacyRequest(staff, id) } catch (e) { error = (e as Error).message }
  if (!d) return <PageShell eyebrow="Data" title="Privacy request" description=""><p role="alert" className="text-sm text-[var(--danger)]">{error}</p><p className="mt-3 text-sm"><Link className="underline" href="/privacy-requests">← All requests</Link></p></PageShell>
  const r = d.request, closed = !!r.closed_at, ready = !!r.verified_at && !closed
  let preview: ErasePreview | null = null
  if (ready && admin && r.kind === "erasure") { try { preview = await previewErasure(staff, id) } catch { preview = null } }
  const root = roleAtLeast(staff.role, "superadmin")
  return (
    <PageShell eyebrow="Data" title={`Privacy request: ${r.kind}`} description={`Status ${r.status}. Due ${String(r.extended_to ?? r.due_at).slice(0, 10)}${r.extended_to ? " (extended)" : ""}. ${r.verified_at ? "The requester confirmed their address." : "Waiting for the requester to confirm their address; no action is possible until then."}`}>
      <p className="mb-4 text-sm"><Link className="underline" href="/privacy-requests">← All requests</Link></p>
      {err && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      <section className={card}>
        <h2 className="text-sm font-semibold">Requester</h2>
        {d.details ? <p className="mt-1 text-sm">{d.details.email}{d.details.linkedin ? ` · ${d.details.linkedin}` : ""}{d.details.note ? ` · “${d.details.note}”` : ""}</p> : <p className="mt-1 text-sm text-muted-foreground">Details wiped.</p>}
        {closed && <p className="mt-2 text-xs text-muted-foreground">Closed {String(r.closed_at).slice(0, 10)} by {r.handled_by ?? "—"}. Outcome: {JSON.stringify(r.outcome)}{r.refusal_reason ? ` · Refused: ${r.refusal_reason}` : ""}</p>}
        <People title="Records at the confirmed email address (included automatically)" people={d.found.byEmail} pick={false} />
        <People title="Records matching the LinkedIn address they gave (not proven theirs: tick to include)" people={d.found.byLinkedIn} pick={ready && admin} />
        {r.verified_at && !d.found.byEmail.length && !d.found.byLinkedIn.length && <p className="mt-3 text-sm text-muted-foreground">No directory record found under this address.</p>}
      </section>
      {ready && admin && (
        <section className={`${card} mt-4`}>
          <h2 className="text-sm font-semibold">Act on this request</h2>
          <form id="actform" action={act} className="mt-3 space-y-3"><input type="hidden" name="id" value={id} />
            {r.kind === "access" && <div><button name="action" value="access" className={btn}>Send the access report to the requester</button><p className="mt-1 text-xs text-muted-foreground">Emails the records above (and any ticked) to the confirmed address. Workspaces that keep their own copy are counted, not named.</p></div>}
            {r.kind === "rectification" && <div className="grid gap-2 sm:grid-cols-2">{[["first_name", "First name"], ["last_name", "Last name"], ["title", "Title"], ["email", "Email"], ["phone", "Phone"], ["linkedin_url", "LinkedIn (company or profile)"], ["person_linkedin_url", "Personal LinkedIn"], ["location", "Location"]].map(([k, l]) => <label key={k} className="text-xs">{l}<input name={`c_${k}`} maxLength={300} className={`${field} mt-1 block w-full`} placeholder="leave empty to keep" /></label>)}<div className="sm:col-span-2"><button name="action" value="rectify" className={btn}>Apply the corrections</button></div></div>}
            {r.kind === "restriction" && <div><button name="action" value="restrict" className={btn}>Restrict these records</button><p className="mt-1 text-xs text-muted-foreground">Kept, but out of matching, discovery and outreach.</p></div>}
            {r.kind === "erasure" && (
              <div>
                {preview ? (
                  <div className="text-xs"><p className="font-medium">Preview (nothing changed yet): {preview.people} {preview.people === 1 ? "person" : "people"} at the confirmed address · {preview.wouldDelete} deleted outright · {preview.wouldAnonymise} kept as an empty shell because a workspace refers to them · {preview.workspacesToTell} workspace(s) will be told, with a count and no name.</p>
                    <ul className="mt-1 list-disc pl-5">{preview.byTable.map((t) => <li key={`${t.table}.${t.column}`}>{t.table}: {t.rows} row(s), {t.fate === "delete" ? "deleted with the person" : t.owner === "workspace" ? "a workspace's own record, left untouched" : "kept (aggregate)"}</li>)}</ul></div>
                ) : <p className="text-xs text-muted-foreground">No directory record found at the confirmed address. Erasing still blocks the address from being added again.</p>}
                <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" /> I reviewed the preview. This cannot be undone.</label>
                <button name="action" value="erase" className={`${btn} mt-2 border-[var(--danger)] text-[var(--danger)]`} disabled={!root}>Erase</button>
                {!root && <span className="ml-2 text-xs text-muted-foreground">A superadmin must do this step.</span>}
              </div>
            )}
            {r.kind === "objection" && <p className="text-xs text-muted-foreground">An objection is carried out at once when the requester confirms. Nothing more to do.</p>}
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <label className="min-w-[240px] flex-1 text-xs">Reason (to refuse, or to extend the deadline)<input name="reason" maxLength={500} placeholder="at least 10 characters" className={`${field} mt-1 block w-full`} /></label>
              <label className="text-xs">Extend by days (1–60, once)<input type="number" name="days" min={1} max={60} className={`${field} mt-1 block w-24`} /></label>
              <button name="action" value="extend" className={btn} formNoValidate>Extend</button>
              <button name="action" value="refuse" className={`${btn} border-[var(--danger)] text-[var(--danger)]`} formNoValidate>Refuse</button>
            </div>
          </form>
        </section>
      )}
    </PageShell>
  )
}
