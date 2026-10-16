"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { reviewSource, withdrawSource, restoreSource } from "@/lib/directory-sources"

const fail = (e: unknown) => `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}`
const s = (f: FormData, k: string) => String(f.get(k) ?? "")

export async function review(formData: FormData) {
  const st = await getSession(); if (!st) redirect("/login")
  let q = "ok=Saved. Anker applies it within a minute."
  try {
    await reviewSource(st, { source: s(formData, "source"), status: s(formData, "status"), kind: s(formData, "kind"), label: s(formData, "label"), supplier: s(formData, "supplier"), acquiredAt: s(formData, "acquired_at"), licenceSummary: s(formData, "licence_summary"), permittedUse: formData.getAll("permitted_use").map(String), forbiddenUse: s(formData, "forbidden_use"), lawfulBasisNote: s(formData, "lawful_basis_note"), reason: s(formData, "reason") })
  } catch (e) { q = fail(e) }
  redirect(`/directory-sources?${q}`)
}

export async function withdraw(formData: FormData) {
  const st = await getSession(); if (!st) redirect("/login")
  let q = ""
  try { const r = await withdrawSource(st, s(formData, "source"), s(formData, "reason")); q = `ok=${encodeURIComponent(`Withdrawn. ${r.people.toLocaleString()} people and ${r.firms.toLocaleString()} firms are no longer usable. Rows are kept until the deletion step.`)}` } catch (e) { q = fail(e) }
  redirect(`/directory-sources?${q}`)
}

export async function restore(formData: FormData) {
  const st = await getSession(); if (!st) redirect("/login")
  let q = "ok=Restored as unreviewed."
  try { await restoreSource(st, s(formData, "source"), s(formData, "reason")) } catch (e) { q = fail(e) }
  redirect(`/directory-sources?${q}`)
}
