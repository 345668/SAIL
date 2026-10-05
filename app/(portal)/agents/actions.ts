"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { setPaused } from "@/lib/agents-control"

export async function pauseAgent(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const agent = String(formData.get("agent") || "")
  try { await setPaused(s, agent === "*" ? null : agent, formData.get("pause") === "1", String(formData.get("reason") || "")) }
  catch (e) { redirect(`/agents?err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}`) }
  redirect(`/agents?ok=${encodeURIComponent(formData.get("pause") === "1" ? "Paused. Runs stop before their next step." : "Resumed.")}`)
}
