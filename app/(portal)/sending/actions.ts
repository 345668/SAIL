"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { setSendingPaused, setEnforcement } from "@/lib/sending-control"

export async function toggleSending(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const pause = formData.get("pause") === "1"
  try { await setSendingPaused(s, pause, String(formData.get("reason") || "")) }
  catch (e) { redirect(`/sending?err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}`) }
  redirect(`/sending?ok=${encodeURIComponent(pause ? "Sending is paused for every workspace. Authorized mail waits." : "Sending resumed.")}`)
}

export async function changeEnforcement(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const on = formData.get("on") === "1"
  try { await setEnforcement(s, on, Number(formData.get("rollout") || 100), String(formData.get("reason") || "")) }
  catch (e) { redirect(`/sending?err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}`) }
  redirect(`/sending?ok=${encodeURIComponent(on ? "Enforcement is on: outreach with no authorization is refused." : "Enforcement is off.")}`)
}
