export function PageShell({
  eyebrow,
  title,
  description,
  action,
  children,
}: {
  eyebrow: string
  title: string
  description?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="border-b border-border">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "var(--accent)" }} />
                {eyebrow}
              </div>
              <h1 className="font-display text-3xl tracking-tight">{title}</h1>
              {description && <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">{description}</p>}
            </div>
            {action}
          </div>
        </div>
      </div>
      <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-8">{children}</div>
    </div>
  )
}

export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-display tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}
