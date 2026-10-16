import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { loadPolicy, PRESETS } from "@/lib/data-policy"
import { save } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const REGION: Record<string, string> = { eu: "EU", us: "United States", sg: "Singapore", self: "our own servers", other: "other", unknown: "not confirmed" }

export default async function DataPolicyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; ok?: string }> }) {
  const [{ id }, { err, ok }] = await Promise.all([params, searchParams])
  const staff = await getSession(); if (!staff) redirect("/login")
  const v = await loadPolicy(id); if (!v) notFound()
  const admin = roleAtLeast(staff.role, "admin")
  return (
    <PageShell eyebrow="Organizations" title={`${v.org.name}: AI data policy`} description="Where this workspace's content may be sent for AI processing: assistant answers, document and deck analysis, search embeddings and Media Studio generation. A policy that leaves no allowed provider makes the feature refuse; nothing is sent.">
      <p className="mb-4 text-sm"><Link className="underline" href="/organizations">← Organizations</Link> · <Link className="underline" href="/subprocessors">Sub-processor register</Link></p>
      {err && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{err}</p>}
      {ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{ok}</p>}
      {!admin && <p className="mb-4 text-sm text-muted-foreground">You can read this. Changing it needs an admin.</p>}
      <section className={card}>
        <form action={save} className="space-y-3"><input type="hidden" name="orgId" value={id} />
          <fieldset><legend className="text-sm font-semibold">Policy</legend>
            {PRESETS.map(([k, label, text]) => {
              const off = k === "no_external" && !v.selfHostedAvailable
              return <label key={k} className={`mt-2 flex items-start gap-2 text-sm ${off ? "opacity-60" : ""}`}><input type="radio" name="preset" value={k} defaultChecked={v.preset === k} disabled={!admin || off} className="mt-1" /><span><strong>{label}</strong>{off ? " (not available yet)" : ""}<br /><span className="text-xs text-muted-foreground">{text}</span></span></label>
            })}
          </fieldset>
          {admin && <><label className="block text-xs">Reason<input name="reason" required minLength={MIN_REASON} maxLength={500} placeholder="e.g. Fund asked for EU-only processing, email 2026-10-20" className="mt-1 block w-full rounded-md border border-border bg-card px-2 py-1 text-xs" /></label>
            <button className="h-8 rounded-md border border-border px-3 text-xs">Save policy</button></>}
          {v.updatedAt && <p className="text-xs text-muted-foreground">Last changed {v.updatedAt.slice(0, 10)} by {v.updatedBy}.</p>}
        </form>
      </section>
      <section className={`${card} mt-4`}>
        <h2 className="text-sm font-semibold">Providers and where they are</h2>
        <ul className="mt-2 text-sm">{v.regions.map((r) => <li key={r.provider}>{r.provider}: {REGION[r.region] ?? r.region}{r.active ? "" : " (not in use)"}</li>)}</ul>
        <p className="mt-2 text-xs text-muted-foreground">From the sub-processor register. A region that has not been confirmed with the provider is treated as not allowed under EU only. Covered by the policy: assistant and tool calls, streaming answers, PDF analysis, embeddings and Media Studio. Not covered yet: image generation by ComfyUI recipes, and anything that runs outside a workspace's request (scheduled jobs).</p>
      </section>
    </PageShell>
  )
}
