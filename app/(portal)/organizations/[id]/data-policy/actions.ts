"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { setPolicy } from "@/lib/data-policy"

export async function save(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const id = String(formData.get("orgId") || "")
  let q = "ok=Saved. Anker applies it within a minute."
  try { await setPolicy(s, id, String(formData.get("preset") || ""), String(formData.get("reason") || "")) }
  catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}` }
  redirect(`/organizations/${encodeURIComponent(id)}/data-policy?${q}`)
}
