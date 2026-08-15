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
      <div className="border-b border-border bg-card">
        <div className="max-w-[1180px] mx-auto px-6 lg:px-12 py-9">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                {eyebrow}
              </div>
              <h1 className="font-display text-[2rem] leading-[1.1] tracking-[-0.02em]">{title}</h1>
              {description && <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground max-w-2xl">{description}</p>}
            </div>
            {action && <div className="shrink-0 pt-1">{action}</div>}
          </div>
        </div>
      </div>
      <div className="max-w-[1180px] mx-auto px-6 lg:px-12 py-9">{children}</div>
    </div>
  )
}

export function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card-elev rounded-xl border border-border p-5 transition-shadow hover:shadow-[var(--shadow-pop)]">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-2.5 text-[2rem] leading-none font-display tabular-nums">{value}</div>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}
