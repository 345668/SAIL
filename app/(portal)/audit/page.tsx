import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"

export const dynamic = "force-dynamic"

const fmt = (s: any) => (s ? new Date(String(s)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—")

export default async function AuditPage() {
  let rows: any[] = []
  let error: string | null = null
  try {
    rows = (await sql`SELECT id, staff_email, action, target, detail, created_at FROM company_audit_log ORDER BY created_at DESC LIMIT 200`) as any[]
  } catch (e: any) {
    error = e?.message || "load failed"
  }

  return (
    <PageShell
      eyebrow="Governance"
      title="Audit log"
      description="Immutable trail of company-portal actions — sign-ins, impersonation grants, API-key changes. Written automatically by the portal."
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn’t load the audit log: <span className="text-[var(--danger)]">{error}</span>. Run the portal migration first.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2.5">When</th>
                <th className="text-left px-4 py-2.5">Staff</th>
                <th className="text-left px-4 py-2.5">Action</th>
                <th className="text-left px-4 py-2.5">Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No audit events yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{fmt(r.created_at)}</td>
                  <td className="px-4 py-2.5">{r.staff_email || "—"}</td>
                  <td className="px-4 py-2.5"><span className="font-mono text-xs">{r.action}</span></td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{r.target || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
