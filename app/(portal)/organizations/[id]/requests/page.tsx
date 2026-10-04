import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { loadControl, roleAtLeast } from "@/lib/tenant-control"
import { listTenantRequests, type RequestRow } from "@/lib/tenant-requests"
import { cancelAction, dryRunAction, exportAction, scheduleAction } from "./actions"

export const dynamic = "force-dynamic"
const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—")
const card = "rounded-xl border border-border card-elev p-5"
const input = "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
const btn = "h-9 px-4 rounded-md text-sm"
const daysLeft = (to: string | null) => (to ? Math.ceil((new Date(to).getTime() - Date.now()) / 86_400_000) : null)

export default async function RequestsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; ok?: string }> }) {
  const { id } = await params; const { err, ok } = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const c = await loadControl(id); if (!c) notFound()
  let requests: RequestRow[] = []; let loadError: string | null = null
  try { requests = await listTenantRequests(staff, id) } catch (e) { loadError = (e as Error).message }
  const admin = roleAtLeast(staff.role, "admin"), root = roleAtLeast(staff.role, "superadmin")
  const exports = requests.filter((r) => r.kind === "export"), erasures = requests.filter((r) => r.kind === "erasure")
  const open = erasures.find((r) => ["dry_run", "approved", "running"].includes(r.status))
  return (
    <PageShell eyebrow="Organizations" title={`${c.org.name}: export and erasure`} description="A workspace's data can be exported to its owners, and erased on request. You see counts and status, never the data itself. Erasure is deliberate: dry run, typed name, a fresh two-factor code, then a seven-day wait that can be cancelled.">
      <p className="mb-4 text-sm"><Link className="underline" href="/organizations">← Organizations</Link> · <Link className="underline" href={`/organizations/${encodeURIComponent(id)}/control`}>Plan and state</Link></p>
      {err && <p className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {loadError && <p className="mb-4 text-sm text-[var(--danger)]">Could not reach the tenant app: {loadError}</p>}

      <section className={card}>
        <h2 className="text-base font-semibold">Export</h2>
        <p className="mt-1 text-sm text-muted-foreground">Builds a bundle of the workspace's data (secrets removed) and emails the owners and admins a sign-in-protected link, valid 14 days. Staff never receive the file.</p>
        {admin && <form action={exportAction} className="mt-3"><input type="hidden" name="orgId" value={id} /><button className={btn} style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>Build and send an export</button></form>}
        {exports.length > 0 && <ul className="mt-3 text-sm">{exports.map((r) => <li key={r.id}>{fmt(r.created_at)} · {r.status}{r.detail?.tables ? ` · ${r.detail.tables} tables, ${r.detail.rows} rows` : ""}{r.detail?.expiresAt && r.status === "done" ? ` · link valid until ${fmt(r.detail.expiresAt)}` : ""}{r.detail?.error ? ` · ${r.detail.error}` : ""} · by {r.requested_by}</li>)}</ul>}
      </section>

      <section className={`${card} mt-4`}>
        <h2 className="text-base font-semibold">Erasure</h2>
        <p className="mt-1 text-sm text-muted-foreground">Deletes the workspace's data and files. Kept by law: billing records. The investor directory and do-not-contact lists are never touched. Needs the workspace to be in the offboarding state, and a superadmin.</p>
        {!root && <p className="mt-2 text-sm text-muted-foreground">You can read this. Starting an erasure needs a superadmin.</p>}
        {root && !open && <form action={dryRunAction} className="mt-3"><input type="hidden" name="orgId" value={id} /><button className={`${btn} border border-border`}>Take a dry run</button><span className="ml-3 text-xs text-muted-foreground">Counts what would go. Deletes nothing.</span></form>}
        {erasures.slice(0, 4).map((r) => {
          const d = r.detail?.dryRun; const left = daysLeft(r.deadline_at)
          return (
            <div key={r.id} className="mt-4 rounded-lg border border-border p-4 text-sm">
              <div className="flex flex-wrap items-center gap-3"><b>{r.status}</b><span className="text-xs text-muted-foreground">{fmt(r.created_at)} · by {r.requested_by}{r.approved_by ? ` · approved by ${r.approved_by}` : ""}</span>
                {left !== null && ["dry_run", "approved"].includes(r.status) && <span className={`text-xs ${left <= 7 ? "text-[var(--danger)]" : "text-muted-foreground"}`}>deadline in {left} days</span>}</div>
              {r.status === "approved" && <p className="mt-2">Runs after <b>{fmt(r.execute_after)}</b>. The owners were told and can object until then.{r.detail?.lastError ? ` Last attempt failed: ${r.detail.lastError}` : ""}</p>}
              {r.status === "rejected" && <p className="mt-2 text-[var(--danger)]">Stopped before running: {r.detail?.blocked}</p>}
              {r.status === "failed" && <p className="mt-2 text-[var(--danger)]">Failed after repeated attempts: {r.detail?.lastError ?? r.detail?.error}. Needs a person.</p>}
              {d && (
                <details className="mt-2"><summary className="cursor-pointer">Dry run: {d.toDelete} rows to delete, {d.toAnonymize} to anonymise, {d.retained} retained · {fmt(d.takenAt)}</summary>
                  <table className="mt-2 w-full text-xs"><tbody>{d.counts.filter((x: any) => x.count > 0).map((x: any) => <tr key={x.table} className="border-b border-border/50"><td className="py-0.5 font-mono">{x.table}</td><td className="text-right tabular-nums">{x.count}</td><td className="pl-3 text-muted-foreground">{x.action}</td></tr>)}</tbody></table>
                  {d.blobs?.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Files: {d.blobs.map((b: any) => `${b.count} ${b.label}`).join(", ")}</p>}</details>)}
              {r.detail?.blockers?.length > 0 && r.status === "dry_run" && <ul className="mt-2 list-disc pl-5 text-[var(--danger)]">{r.detail.blockers.map((b: any) => <li key={b.code}>{b.message}</li>)}</ul>}
              {root && r.status === "dry_run" && !(r.detail?.blockers?.length) && (
                <form action={scheduleAction} className="mt-3 grid max-w-xl gap-3">
                  <input type="hidden" name="orgId" value={id} /><input type="hidden" name="requestId" value={r.id} />
                  <label className="text-sm">Type the workspace name to confirm: <b>{c.org.name}</b><input name="confirmName" required autoComplete="off" className={input} /></label>
                  <label className="text-sm">Two-factor code (the next one from your authenticator)<input name="code" required inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" className={input} /></label>
                  <button className={`${btn} bg-[var(--danger)] text-white`}>Schedule erasure in 7 days</button>
                </form>)}
              {root && ["dry_run", "approved"].includes(r.status) && <form action={cancelAction} className="mt-3"><input type="hidden" name="orgId" value={id} /><input type="hidden" name="requestId" value={r.id} /><button className="text-xs underline">Cancel this request</button></form>}
            </div>)
        })}
      </section>
    </PageShell>
  )
}
