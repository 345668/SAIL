import { sql } from "@/lib/db"

/**
 * What the AI router actually did — the observing half of this page.
 *
 * The config above sets keys and flips per-task switches. Until the tenant app
 * started recording calls there was no way to see the result of either: a key
 * that had stopped working, a task quietly failing over to a second provider,
 * or a switch someone turned off months ago all looked identical from here.
 *
 * Reads `ai_calls` from the same shared database this page already uses for
 * `system_settings`, rather than proxying to the tenant — the rows are plain
 * telemetry with no engine behind them, and a proxy hop would add a failure
 * mode for nothing.
 *
 * No prompt or completion text exists in that table by design, so nothing
 * sensitive can reach this page.
 */

const WINDOW_HOURS = 24

interface Totals {
  calls: number
  failures: number
  suppressed: number
  failovers: number
  outputTokens: number | null
  p50: number | null
  p95: number | null
}

async function load(): Promise<{
  totals: Totals
  byProvider: Array<{ provider: string; calls: number; failures: number; failovers: number; avg: number | null }>
  byTask: Array<{ task: string; calls: number; failures: number; avg: number | null }>
  failures: Array<{ at: string; task: string | null; provider: string; status: number | null; error: string | null }>
  error: string | null
}> {
  const empty = { calls: 0, failures: 0, suppressed: 0, failovers: 0, outputTokens: null, p50: null, p95: null }
  try {
    const [t] = (await sql`
      SELECT COUNT(*) FILTER (WHERE provider <> 'disabled')::int AS calls,
             COUNT(*) FILTER (WHERE NOT ok AND provider <> 'disabled')::int AS failures,
             COUNT(*) FILTER (WHERE provider = 'disabled')::int AS suppressed,
             COUNT(*) FILTER (WHERE attempt > 0)::int AS failovers,
             SUM(output_tokens)::bigint AS output_tokens,
             PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
             PERCENTILE_DISC(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
      FROM ai_calls WHERE created_at > now() - (${WINDOW_HOURS} || ' hours')::interval
    `) as any[]

    const byProvider = (await sql`
      SELECT provider, COUNT(*)::int AS calls,
             COUNT(*) FILTER (WHERE NOT ok)::int AS failures,
             COUNT(*) FILTER (WHERE attempt > 0)::int AS failovers,
             AVG(duration_ms)::int AS avg
      FROM ai_calls WHERE created_at > now() - (${WINDOW_HOURS} || ' hours')::interval
      GROUP BY 1 ORDER BY calls DESC LIMIT 12
    `) as any[]

    const byTask = (await sql`
      SELECT COALESCE(task, '(untagged)') AS task, COUNT(*)::int AS calls,
             COUNT(*) FILTER (WHERE NOT ok)::int AS failures,
             AVG(duration_ms)::int AS avg
      FROM ai_calls WHERE created_at > now() - (${WINDOW_HOURS} || ' hours')::interval
      GROUP BY 1 ORDER BY calls DESC LIMIT 15
    `) as any[]

    const failures = (await sql`
      SELECT created_at, task, provider, http_status, error
      FROM ai_calls
      WHERE NOT ok AND provider <> 'disabled'
        AND created_at > now() - (${WINDOW_HOURS} || ' hours')::interval
      ORDER BY created_at DESC LIMIT 8
    `) as any[]

    return {
      totals: {
        calls: Number(t?.calls ?? 0),
        failures: Number(t?.failures ?? 0),
        suppressed: Number(t?.suppressed ?? 0),
        failovers: Number(t?.failovers ?? 0),
        outputTokens: t?.output_tokens == null ? null : Number(t.output_tokens),
        p50: t?.p50 == null ? null : Number(t.p50),
        p95: t?.p95 == null ? null : Number(t.p95),
      },
      byProvider: byProvider.map((r) => ({ provider: String(r.provider), calls: Number(r.calls), failures: Number(r.failures), failovers: Number(r.failovers), avg: r.avg == null ? null : Number(r.avg) })),
      byTask: byTask.map((r) => ({ task: String(r.task), calls: Number(r.calls), failures: Number(r.failures), avg: r.avg == null ? null : Number(r.avg) })),
      failures: failures.map((r) => ({ at: new Date(String(r.created_at)).toISOString(), task: r.task ? String(r.task) : null, provider: String(r.provider), status: r.http_status == null ? null : Number(r.http_status), error: r.error ? String(r.error) : null })),
      error: null,
    }
  } catch (e: any) {
    return { totals: empty, byProvider: [], byTask: [], failures: [], error: e?.message || "query failed" }
  }
}

const ms = (n: number | null) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`)
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—")

function Stat({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${alert ? "text-[var(--danger)]" : ""}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

export async function AiUsagePanel() {
  const { totals, byProvider, byTask, failures, error } = await load()

  if (error) {
    return (
      <div className="mt-8 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        Couldn’t read AI usage: <span className="text-[var(--danger)]">{error}</span>. The{" "}
        <code>ai_calls</code> table is created by the tenant migration{" "}
        <code>2026-09-21-ai-call-log.sql</code>.
      </div>
    )
  }

  if (totals.calls === 0 && totals.suppressed === 0) {
    return (
      <div className="mt-8 rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
        No AI calls recorded in the last {WINDOW_HOURS} hours. Recording starts the first time the
        tenant router runs a task — an empty panel here means nothing has called the AI, not that
        recording is broken.
      </div>
    )
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">What the router did</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Last {WINDOW_HOURS} hours. No prompts or completions are stored — only what was called, by
        whom, and how it went.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Calls" value={String(totals.calls)} />
        <Stat
          label="Failures"
          value={pct(totals.failures, totals.calls)}
          hint={`${totals.failures} of ${totals.calls}`}
          alert={totals.calls > 0 && totals.failures / totals.calls > 0.1}
        />
        <Stat
          label="Failed over"
          value={String(totals.failovers)}
          // The number this panel exists for. Failover is silent by design:
          // the call succeeds, on a provider nobody chose.
          hint={totals.failovers ? "served by a fallback provider" : "first choice answered"}
          alert={totals.calls > 0 && totals.failovers / totals.calls > 0.2}
        />
        <Stat label="Latency p50 / p95" value={`${ms(totals.p50)} / ${ms(totals.p95)}`} />
        <Stat
          label="Output tokens"
          value={totals.outputTokens == null ? "not reported" : totals.outputTokens.toLocaleString()}
          hint={totals.suppressed ? `${totals.suppressed} suppressed by a task switch` : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">By provider</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="py-1 text-left">Provider</th><th className="text-right">Calls</th><th className="text-right">Failed</th><th className="text-right">Fallback</th><th className="text-right">Avg</th></tr>
            </thead>
            <tbody>
              {byProvider.map((r) => (
                <tr key={r.provider} className="border-t border-border">
                  <td className="py-1.5">{r.provider === "disabled" ? <span className="text-muted-foreground">switched off</span> : r.provider}</td>
                  <td className="text-right">{r.calls}</td>
                  <td className="text-right">{r.failures || ""}</td>
                  <td className="text-right">{r.failovers || ""}</td>
                  <td className="text-right text-muted-foreground">{ms(r.avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="text-sm font-semibold">By task</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="py-1 text-left">Task</th><th className="text-right">Calls</th><th className="text-right">Failed</th><th className="text-right">Avg</th></tr>
            </thead>
            <tbody>
              {byTask.map((r) => (
                <tr key={r.task} className="border-t border-border">
                  <td className="py-1.5">{r.task}</td>
                  <td className="text-right">{r.calls}</td>
                  <td className="text-right">{r.failures || ""}</td>
                  <td className="text-right text-muted-foreground">{ms(r.avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {failures.length ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Recent failures</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {failures.map((f, i) => (
              <li key={i} className="border-t border-border py-1.5">
                <span className="text-muted-foreground">{f.at.slice(5, 16).replace("T", " ")}</span>{" "}
                <span className="font-medium">{f.provider}</span>
                {f.task ? <span className="text-muted-foreground"> · {f.task}</span> : null}
                {f.status ? <span className="text-muted-foreground"> · {f.status}</span> : null}
                <div className="text-muted-foreground">{f.error}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
