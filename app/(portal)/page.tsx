import { sql } from "@/lib/db"
import { PageShell, StatTile } from "@/components/page-shell"

export const dynamic = "force-dynamic"

async function count(q: Promise<any[]>): Promise<number | null> {
  try {
    const rows = await q
    return Number((rows[0] as any)?.n ?? 0)
  } catch {
    return null
  }
}

export default async function Dashboard() {
  const [orgs, staff, investors, firms, articles, keys] = await Promise.all([
    count(sql`SELECT count(*)::int AS n FROM organizations`),
    count(sql`SELECT count(*)::int AS n FROM company_staff WHERE NOT disabled`),
    count(sql`SELECT count(*)::int AS n FROM investors`),
    count(sql`SELECT count(*)::int AS n FROM investment_firms`),
    count(sql`SELECT count(*)::int AS n FROM news_articles`),
    count(sql`SELECT count(*)::int AS n FROM platform_api_keys WHERE NOT disabled`),
  ])

  const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString())

  return (
    <PageShell
      eyebrow="Overview"
      title="Platform administration"
      description="You are on the company portal — platform-wide control, firewalled from tenant workspaces. Everything here affects the whole Venture OS."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatTile label="Tenant organizations" value={fmt(orgs)} hint="Workspaces on the platform" />
        <StatTile label="Investor database" value={fmt(investors)} hint="Global — shared by every tenant" />
        <StatTile label="Investment firms" value={fmt(firms)} hint="Global firm records" />
        <StatTile label="Newsroom articles" value={fmt(articles)} hint="Public an-ker.de/newsroom" />
        <StatTile label="Platform API keys" value={fmt(keys)} hint="Active, platform-scoped" />
        <StatTile label="Company staff" value={fmt(staff)} hint="With portal access" />
      </div>

      <div className="mt-8 rounded-xl border border-border bg-card p-5">
        <h2 className="font-display text-lg">What lives here vs. the tenant app</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Confirmed by scope audit: the global investor database, the AI router and
          platform API keys, the platform email identity, the public newsroom, and
          all-user administration are platform-wide — so they live here, not on the
          Venture OS tenant app. Tenants keep only their own org/user-scoped data.
        </p>
      </div>
    </PageShell>
  )
}
