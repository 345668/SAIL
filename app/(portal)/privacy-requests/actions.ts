"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { actOnPrivacyRequest, type Action } from "@/lib/privacy-requests"

const done: Record<string, string> = { access: "Access report sent to the requester.", rectify: "Corrected, and the requester has been told.", restrict: "Restricted, and the requester has been told.", refuse: "Refused, and the requester has been told.", extend: "Extended, and the requester has been told.", erase: "Erased." }
export async function act(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const id = String(formData.get("id") || ""), action = String(formData.get("action") || "") as Action["action"]
  const ids = formData.getAll("ids").map(String)
  const changes: Record<string, string> = {}
  for (const k of ["first_name", "last_name", "title", "email", "phone", "linkedin_url", "person_linkedin_url", "location"]) { const v = String(formData.get(`c_${k}`) ?? "").trim(); if (v) changes[k] = v }
  let q = `ok=${encodeURIComponent(done[action] ?? "Done.")}`
  try { await actOnPrivacyRequest(s, id, { action, ids, changes, reason: String(formData.get("reason") || ""), days: Number(formData.get("days") || 0) }) }
  catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed that cannot be repeated.")}` }
  redirect(`/privacy-requests/${id}?${q}`)
}
