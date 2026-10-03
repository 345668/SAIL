"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { startInspection } from "@/lib/inspect"

export async function beginInspection(formData: FormData) {
  const staff = await getSession()
  if (!staff) redirect("/login")
  const orgId = String(formData.get("orgId") || "")
  const reason = String(formData.get("reason") || "")
  let id: number
  try {
    id = await startInspection({ id: staff.id, email: staff.email }, orgId, reason)
  } catch (e) {
    redirect(`/organizations/${encodeURIComponent(orgId)}?err=${encodeURIComponent((e as Error).message)}`)
  }
  redirect(`/organizations/${encodeURIComponent(orgId)}?i=${id}`)
}
