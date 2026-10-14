"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { grantCredits, revokeCredits } from "@/lib/studio-credits"

const back = (id: string, q: string) => redirect(`/organizations/${encodeURIComponent(id)}/credits?${q}`)
const msg = (e: unknown) => encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")

export async function grant(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const id = String(formData.get("orgId") || "")
  let done = ""
  try { const n = await grantCredits(s, id, { credits: Number(formData.get("credits")), reason: String(formData.get("reason") || "") }); done = `Granted ${n.toLocaleString("en")} bonus credits.` }
  catch (e) { back(id, `err=${msg(e)}`) }
  back(id, `ok=${encodeURIComponent(done)}`)
}

export async function revoke(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const id = String(formData.get("orgId") || "")
  let done = ""
  try { const n = await revokeCredits(s, id, { credits: Number(formData.get("credits")), reason: String(formData.get("reason") || "") }); done = `Took back ${n.toLocaleString("en")} bonus credits.` }
  catch (e) { back(id, `err=${msg(e)}`) }
  back(id, `ok=${encodeURIComponent(done)}`)
}
