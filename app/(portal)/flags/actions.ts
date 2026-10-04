"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError, setFlag } from "@/lib/tenant-control"

export async function saveFlag(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  try {
    await setFlag(s, { key: String(formData.get("key") || "").trim(), enabled: formData.get("enabled") === "on", rolloutPct: Number(formData.get("rollout") || 100), description: String(formData.get("description") || "") || undefined, reason: String(formData.get("reason") || "") })
  } catch (e) { redirect(`/flags?err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}`) }
  redirect("/flags?ok=Saved.")
}
