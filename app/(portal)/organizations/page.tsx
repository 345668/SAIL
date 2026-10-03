import { sql } from "@/lib/db"
import { PageShell } from "@/components/page-shell"
import { OrgTable, type OrgRow } from "./org-table"

export const dynamic = "force-dynamic"

async function loadOrgs(): Promise<{ rows: OrgRow[]; error: string | null }> {
  try {
    const rows = await sql`
      SELECT o.id,
             o.name,
             o.created_at,
             COALESCE(m.members, 0) AS members,
             m.personas,
             a.last_ai,
             COALESCE(a.calls30, 0) AS calls30
      FROM organizations o
      LEFT JOIN (
        SELECT org_id,
               count(*)::int AS members,
               array_remove(array_agg(DISTINCT persona), NULL) AS personas
        FROM memberships GROUP BY org_id
      ) m ON m.org_id = o.id
      LEFT JOIN (
        SELECT workspace_id, max(created_at) AS last_ai,
               count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS calls30
        FROM ai_calls WHERE workspace_id IS NOT NULL GROUP BY workspace_id
      ) a ON a.workspace_id = o.id
      ORDER BY o.created_at DESC
      LIMIT 500`
    return {
      rows: (rows as any[]).map((r) => ({
        id: r.id,
        name: r.name ?? "(unnamed)",
        createdAt: r.created_at ? String(r.created_at) : null,
        members: Number(r.members ?? 0),
        lastAi: r.last_ai ? String(r.last_ai) : null,
        calls30: Number(r.calls30 ?? 0),
        personas: Array.isArray(r.personas) ? r.personas.filter(Boolean) : [],
      })),
      error: null,
    }
  } catch (e: any) {
    return { rows: [], error: e?.message || "Failed to load organizations" }
  }
}

export default async function OrganizationsPage() {
  const { rows, error } = await loadOrgs()
  return (
    <PageShell
      eyebrow="Overview"
      title="Organizations"
      description="Every tenant workspace on the platform. “Inspect” opens a metadata-only view (plan, usage, errors, counts) with a stated reason; the workspace can see it was opened."
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn’t load organizations: <span className="text-[var(--danger)]">{error}</span>
          <div className="mt-1">Run the <code>2026-08-15-company-portal.sql</code> migration and confirm <code>NEON_DATABASE_URL</code>.</div>
        </div>
      ) : (
        <OrgTable rows={rows} />
      )}
    </PageShell>
  )
}
