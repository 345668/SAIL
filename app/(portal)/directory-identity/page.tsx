import Link from "next/link"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PageShell } from "@/components/page-shell"
import { roleAtLeast, MIN_REASON } from "@/lib/tenant-control"
import { counts, listCandidates, PAGE, type CandidateView, type FirmView, type PersonView, type Tier } from "@/lib/directory-identity"
import { decideAction, reopenAction, runNow } from "./actions"

export const dynamic = "force-dynamic"
const card = "rounded-xl border border-border card-elev p-5"
const small = "rounded-md border border-border bg-card px-2 py-1 text-xs"
const btn = "h-8 rounded-md border border-border px-3 text-xs"

function chips(c: CandidateView): string[] {
  const e = c.evidence ?? {}, out: string[] = []
  if (c.kind === "firm") {
    if (e.sameName) out.push("same name")
    else if (e.sharedKeys?.length) out.push("a former name matches")
    if (e.sameHost) out.push(`same website (${e.sameHost})`)
    if (e.prefix) out.push(`one name begins with the other (“${e.prefix.short}”)`)
    if (e.initials) out.push("one is the initials of the other")
    if (e.sharedPeople) out.push(`${e.sharedPeople} person(s) at both`)
    if (e.hostConflict) out.push("different websites")
  } else {
    for (const b of e.by ?? []) out.push(b === "email" ? "same email" : b === "profile" ? "same LinkedIn profile" : "same name at the same firm")
    out.push(e.namesCompatible ? "names compatible" : "names differ")
    if (e.roleMailbox) out.push("team mailbox")
  }
  return out
}
const Firm = ({ f }: { f: FirmView | null }) => f ? <div className="text-xs"><div className="text-sm font-medium">{f.name}</div><div className="break-all text-muted-foreground">{f.website || "no website"}</div><div>{f.location || "no location"}</div><div>{f.people} {f.people === 1 ? "person" : "people"} · {f.source}</div></div> : <div className="text-xs text-muted-foreground">Record no longer exists.</div>
const Person = ({ p }: { p: PersonView | null }) => p ? <div className="text-xs"><div className="text-sm font-medium">{p.name}</div><div>{p.title || "no title"} · {p.firm || "no firm"}</div><div className="break-all">{p.email || "no email"}</div><div className="break-all text-muted-foreground">{p.profile || "no profile"}</div><div>{p.source}</div></div> : <div className="text-xs text-muted-foreground">Record no longer exists.</div>

export default async function DirectoryIdentityPage({ searchParams }: { searchParams: Promise<{ kind?: string; tier?: string; status?: string; page?: string; err?: string; ok?: string }> }) {
  const sp = await searchParams
  const staff = await getSession(); if (!staff) redirect("/login")
  const admin = roleAtLeast(staff.role, "admin")
  const kind = sp.kind === "person" ? "person" : "firm"
  const status = ["open", "same", "distinct", "related", "stale"].includes(sp.status ?? "") ? sp.status! : "open"
  const withPossible = sp.tier === "all"
  const tiers: Tier[] = withPossible ? ["certain", "probable", "possible"] : ["certain", "probable"]
  const page = Math.max(0, Number(sp.page) || 0)
  const [cs, list] = await Promise.all([counts(), listCandidates({ kind, tiers, status, page })])
  const n = (k: string, t: string, s = "open") => cs.filter((c) => c.kind === k && c.tier === t && c.status === s).reduce((a, c) => a + c.n, 0)
  const q = (o: Record<string, string>) => `/directory-identity?${new URLSearchParams({ kind, tier: sp.tier ?? "", status, page: "0", ...o })}`
  const pages = Math.ceil(list.total / PAGE)
  return (
    <PageShell eyebrow="Data" title="Directory identity" description="Records in the shared investor directory that may be the same firm or the same person. The detector proposes; you decide. Nothing is merged yet: a decision is recorded, and “not the same” is remembered so the pair is never proposed again. Firms are never merged automatically; “related” keeps a brand and its programmes as separate records.">
      {sp.err && <p role="alert" className="mb-4 rounded-md border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{sp.err}</p>}
      {sp.ok && <p className="mb-4 rounded-md border border-border p-3 text-sm">{sp.ok}</p>}
      <section className={`${card} mb-4`}>
        <p className="text-sm">Open: firms <strong>{n("firm", "probable")}</strong> probable, {n("firm", "possible")} possible · people <strong>{n("person", "certain")}</strong> certain, <strong>{n("person", "probable")}</strong> probable, {n("person", "possible")} possible. Detection runs every night.</p>
        {admin && <form action={runNow} className="mt-2"><input type="hidden" name="kind" value={kind} /><input type="hidden" name="tier" value={sp.tier ?? ""} /><input type="hidden" name="status" value={status} /><button className={btn}>Run detection now</button></form>}
      </section>
      <nav className="mb-4 flex flex-wrap items-center gap-3 text-sm" aria-label="Filters">
        <Link className={kind === "firm" ? "font-semibold underline" : "underline"} href={q({ kind: "firm" })}>Firms</Link>
        <Link className={kind === "person" ? "font-semibold underline" : "underline"} href={q({ kind: "person" })}>People</Link>
        <span className="text-muted-foreground">·</span>
        {["open", "same", "distinct", "related", "stale"].map((s) => <Link key={s} className={status === s ? "font-semibold underline" : "underline"} href={q({ status: s })}>{s}</Link>)}
        <span className="text-muted-foreground">·</span>
        <Link className="underline" href={q({ tier: withPossible ? "" : "all" })}>{withPossible ? "Hide possible" : "Include possible (noisy)"}</Link>
      </nav>
      <p className="mb-3 text-sm text-muted-foreground">{list.total.toLocaleString()} {status} {kind === "firm" ? "firm" : "person"} pair(s) shown{withPossible ? "" : " (certain and probable)"}. Page {page + 1} of {Math.max(1, pages)}.</p>
      <div className="space-y-4">{list.items.map((c) => (
        <section key={c.id} className={card}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span><strong>{c.tier}</strong> · score {c.score} · detector suggests <strong>{c.suggest === "related" ? "related (parent and programme)" : "the same"}</strong></span><span className="text-muted-foreground">{chips(c).join(" · ")}</span></div>
          <div className="grid gap-4 sm:grid-cols-2">{c.kind === "firm" ? <><Firm f={c.a as FirmView | null} /><Firm f={c.b as FirmView | null} /></> : <><Person p={c.a as PersonView | null} /><Person p={c.b as PersonView | null} /></>}</div>
          {admin && c.status === "open" && (
            <form action={decideAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <input type="hidden" name="id" value={c.id} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="tier" value={sp.tier ?? ""} /><input type="hidden" name="status" value={status} /><input type="hidden" name="page" value={page} />
              <input name="reason" maxLength={500} placeholder="Reason (optional)" className={`${small} min-w-[180px] flex-1`} aria-label="Reason" />
              <button name="decision" value="same" className={btn}>Same</button>
              <button name="decision" value="distinct" className={btn}>Not the same</button>
              {c.kind === "firm" && <><select name="parent" className={small} aria-label="Parent firm if related"><option value="">Parent…</option><option value={String(c.a?.id ?? "")}>{(c.a as FirmView | null)?.name}</option><option value={String(c.b?.id ?? "")}>{(c.b as FirmView | null)?.name}</option></select><button name="decision" value="related" className={btn}>Related</button></>}
            </form>
          )}
          {admin && ["same", "distinct", "related"].includes(c.status) && (
            <form action={reopenAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="tier" value={sp.tier ?? ""} /><input type="hidden" name="status" value={status} /><input type="hidden" name="page" value={page} />
              <input name="reason" required minLength={MIN_REASON} maxLength={500} placeholder="Why reopen (10+ characters)" className={`${small} min-w-[220px] flex-1`} aria-label="Reason to reopen" /><button className={btn}>Reopen</button></form>
          )}
        </section>))}
        {list.items.length === 0 && <p className="text-sm text-muted-foreground">Nothing here.</p>}
      </div>
      <div className="mt-4 flex gap-4 text-sm">{page > 0 && <Link className="underline" href={q({ page: String(page - 1) })}>← Previous</Link>}{page + 1 < pages && <Link className="underline" href={q({ page: String(page + 1) })}>Next →</Link>}</div>
    </PageShell>
  )
}
