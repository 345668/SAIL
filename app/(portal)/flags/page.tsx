import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { listFlags, MIN_REASON, roleAtLeast } from "@/lib/tenant-control"
import { saveFlag } from "./actions"

export const dynamic = "force-dynamic"
const input = "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
const fmt = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })

export default async function FlagsPage({ searchParams }: { searchParams: Promise<{ err?: string; ok?: string }> }) {
  const staff = await getSession(); if (!staff) redirect("/login")
  const { err, ok } = await searchParams
  const flags = await listFlags(); const admin = roleAtLeast(staff.role, "admin")
  return (
    <PageShell eyebrow="Platform" title="Flags and maintenance" description="Switch features on for a share of workspaces, and put the platform in maintenance. A rollout is decided per workspace by a stable hash, so a workspace does not flip in and out. Maintenance stops AI runs and sending for everyone and shows a banner; only a superadmin can change it.">
      {err && <p className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      <div className="space-y-3">
        {flags.map((f) => (
          <form key={f.key} action={saveFlag} className="grid items-end gap-3 rounded-xl border border-border card-elev p-4 md:grid-cols-[1fr_auto_110px_1.2fr_auto]">
            <input type="hidden" name="key" value={f.key} /><input type="hidden" name="description" value={f.description ?? ""} />
            <div><div className="font-mono text-sm">{f.key}</div><div className="text-xs text-muted-foreground">{f.description ?? ""}{f.updated_by ? ` · ${f.updated_by}, ${fmt(f.updated_at)}` : ""}</div></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={f.enabled} disabled={!admin} /> On</label>
            <label className="text-xs">Rollout %<input name="rollout" type="number" min={0} max={100} defaultValue={f.rollout_pct} disabled={!admin} className={input} /></label>
            <label className="text-xs">Reason<input name="reason" required minLength={MIN_REASON} disabled={!admin} className={input} placeholder="Why this change" /></label>
            {admin && <button className="h-9 rounded-md px-4 text-sm" style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}>Save</button>}
          </form>))}
      </div>
      {admin && (
        <form action={saveFlag} className="mt-6 grid max-w-3xl items-end gap-3 rounded-xl border border-border p-4 md:grid-cols-[1fr_1fr_110px_auto]">
          <label className="text-xs">New flag key<input name="key" required pattern="[a-z][a-z0-9_]{1,40}" className={input} placeholder="new_matching_engine" /></label>
          <label className="text-xs">Description<input name="description" maxLength={200} className={input} /></label>
          <label className="text-xs">Rollout %<input name="rollout" type="number" min={0} max={100} defaultValue={0} className={input} /></label>
          <input type="hidden" name="reason" value="New flag created, off until rolled out" /><button className="h-9 rounded-md border border-border px-4 text-sm">Create (off)</button>
        </form>)}
    </PageShell>
  )
}
