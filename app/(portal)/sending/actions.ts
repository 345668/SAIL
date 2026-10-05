"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { setSendingPaused } from "@/lib/sending-control"

export async function toggleSending(formData: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const pause = formData.get("pause") === "1"
  try { await setSendingPaused(s, pause, String(formData.get("reason") || "")) }
  catch (e) { redirect(`/sending?err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}`) }
  redirect(`/sending?ok=${encodeURIComponent(pause ? "Sending is paused for every workspace. Authorized mail waits." : "Sending resumed.")}`)
}
