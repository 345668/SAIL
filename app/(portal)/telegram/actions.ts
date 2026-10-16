"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { setWebhook } from "@/lib/telegram-channel"

export async function webhookAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const action = String(f.get("action") || "") as "register" | "disable"
  let q = `ok=${encodeURIComponent(action === "register" ? "Webhook registered. Telegram now sends messages to Anker." : "Webhook removed. The bot is deaf until you register it again.")}`
  try { await setWebhook(s, action) } catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong.")}` }
  redirect(`/telegram?${q}`)
}
