"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError, FEATURES, LIMITS, saveEntitlements, setLifecycle, type State } from "@/lib/tenant-control"

async function staffOrLogin() { const s = await getSession(); if (!s) redirect("/login"); return s }
const back = (id: string, q: string) => redirect(`/organizations/${encodeURIComponent(id)}/control?${q}`)
const msg = (e: unknown) => encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")

export async function savePlan(formData: FormData) {
  const s = await staffOrLogin(); const id = String(formData.get("orgId") || "")
  try {
    const features: Record<string, "plan" | "on" | "off"> = {}
    for (const f of FEATURES) { const v = String(formData.get(`f_${f.key}`) || "plan"); features[f.key] = v === "on" || v === "off" ? v : "plan" }
    const limits: Record<string, string> = {}
    for (const l of LIMITS) limits[l.key] = String(formData.get(`l_${l.key}`) || "")
    await saveEntitlements(s, id, { plan: String(formData.get("plan") || "") || null, features, limits, notes: String(formData.get("notes") || ""), expectedVersion: Number(formData.get("version") || 0), reason: String(formData.get("reason") || "") })
  } catch (e) { back(id, `err=${msg(e)}`) }
  back(id, "ok=Saved.")
}

export async function changeState(formData: FormData) {
  const s = await staffOrLogin(); const id = String(formData.get("orgId") || "")
  try { await setLifecycle(s, id, String(formData.get("to")) as State, String(formData.get("reason") || ""), String(formData.get("trialEnds") || "") || null) }
  catch (e) { back(id, `err=${msg(e)}`) }
  back(id, "ok=State changed.")
}
