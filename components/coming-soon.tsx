import { PageShell } from "./page-shell"
import { ArrowRight } from "lucide-react"

/**
 * Placeholder for Owner-Console feature panels being migrated out of the tenant
 * app into this portal. Lists what will land here so the map is honest.
 */
export function ComingSoon({
  eyebrow,
  title,
  description,
  migrating,
}: {
  eyebrow: string
  title: string
  description: string
  migrating: { name: string; from: string }[]
}) {
  return (
    <PageShell eyebrow={eyebrow} title={title} description={description}>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-3">
          Migrating into this portal
        </div>
        <ul className="space-y-2">
          {migrating.map((m) => (
            <li key={m.name} className="flex items-center gap-3 text-sm">
              <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="font-medium">{m.name}</span>
              <span className="text-muted-foreground">— from tenant <code className="text-xs">{m.from}</code></span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-muted-foreground">
          These panels currently live on the tenant app behind the owner gate. They’ll be
          moved here (or served here against the shared DB) so no platform-ops tooling
          remains on the Venture OS tenant surface.
        </p>
      </div>
    </PageShell>
  )
}
