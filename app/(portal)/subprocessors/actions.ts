"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { saveSubprocessor } from "@/lib/data-policy"

export async function save(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const f = (k: string) => String(formData.get(k) ?? "")
  let q = "ok=Saved. The public page and the AI router use it within a minute."
  try {
    await saveSubprocessor(s, { slug: f("slug"), purpose: f("purpose"), region: f("region"), regionBasis: f("region_basis"), dpaStatus: f("dpa_status"), trainingOptOut: f("training_opt_out"), retention: f("retention"), termsUrl: f("terms_url"), lastVerified: f("last_verified"), active: formData.get("active") === "on", public: formData.get("public") === "on", notes: f("notes"), dataClasses: f("data_classes"), reason: f("reason") })
  } catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}` }
  redirect(`/subprocessors?${q}`)
}
