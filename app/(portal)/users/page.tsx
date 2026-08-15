import { sql } from "@/lib/db"
import { PageShell, StatTile } from "@/components/page-shell"

export const dynamic = "force-dynamic"

const fmt = (s: any) => (s ? new Date(String(s)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—")

export default async function UsersPage() {
  let staff: any[] = []
  let tenantUsers: number | null = null
  let error: string | null = null
  try {
    staff = (await sql`SELECT id, email, name, role, disabled, created_at, last_login_at FROM company_staff ORDER BY created_at`) as any[]
  } catch (e: any) {
    error = e?.message || "load failed"
  }
  try {
    const r = await sql`SELECT count(*)::int AS n FROM memberships`
    tenantUsers = Number((r[0] as any)?.n ?? 0)
  } catch { tenantUsers = null }

  return (
    <PageShell
      eyebrow="Overview"
      title="Users & roles"
      description="Company-portal staff (this identity store) and a roll-up of tenant memberships. Full tenant-user administration and role editing land in a later phase."
    >
      <div className="grid sm:grid-cols-3 gap-4 mb-8">
        <StatTile label="Company staff" value={error ? "—" : staff.length} hint="Portal access" />
        <StatTile label="Tenant memberships" value={tenantUsers == null ? "—" : tenantUsers.toLocaleString()} hint="Across all orgs" />
        <StatTile label="Superadmins" value={error ? "—" : staff.filter((s) => s.role === "superadmin").length} />
      </div>

      <h2 className="font-display text-lg mb-3">Company staff</h2>
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn’t load staff: <span className="text-[var(--danger)]">{error}</span>. Run the portal migration + seed the first staff account.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2.5">Email</th>
                <th className="text-left px-4 py-2.5">Name</th>
                <th className="text-left px-4 py-2.5">Role</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Last login</th>
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No staff yet — run <code>npm run seed:staff</code>.</td></tr>
              ) : staff.map((s) => (
                <tr key={s.id} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{s.email}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.name || "—"}</td>
                  <td className="px-4 py-2.5"><span className="font-mono text-[11px] uppercase tracking-wider border border-border rounded px-1.5 py-0.5">{s.role}</span></td>
                  <td className="px-4 py-2.5">{s.disabled ? <span className="text-muted-foreground">Disabled</span> : <span style={{ color: "var(--ok)" }}>Active</span>}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{fmt(s.last_login_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  )
}
