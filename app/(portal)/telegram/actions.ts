"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { removeConnection, revokeDevice, setWebhook } from "@/lib/telegram-channel"

export async function webhookAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const action = String(f.get("action") || "") as "register" | "disable"
  let q = `ok=${encodeURIComponent(action === "register" ? "Webhook registered. Telegram now sends messages to Anker." : "Webhook removed. The bot is deaf until you register it again.")}`
  try { await setWebhook(s, action) } catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong.")}` }
  redirect(`/telegram?${q}`)
}

export async function removeConnectionAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  let q: string
  try { const n = await removeConnection(s, String(f.get("botId") || ""), String(f.get("reason") || "")); q = `ok=${encodeURIComponent(`Connection removed. ${n} device${n === 1 ? "" : "s"} told and disconnected, the token deleted and the workspace owners notified.`)}` }
  catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong.")}` }
  redirect(`/telegram?${q}`)
}
export async function revokeDeviceAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  let q: string
  try { await revokeDevice(s, String(f.get("linkId") || ""), String(f.get("reason") || "")); q = `ok=${encodeURIComponent("Device disconnected and its owner notified.")}` }
  catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong.")}` }
  redirect(`/telegram?${q}`)
}
