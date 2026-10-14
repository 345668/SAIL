"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { saveRate } from "@/lib/studio-credits"

export async function updateRate(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  let q = "ok=Price saved. Anker uses it within a minute."
  try {
    await saveRate(s, { model: String(formData.get("model") || ""), resolution: String(formData.get("resolution") || ""), credits: Number(formData.get("credits")), active: formData.get("active") === "on", reason: String(formData.get("reason") || "") })
  } catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}` }
  redirect(`/studio-credits?${q}`)
}
