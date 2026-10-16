"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { saveRule, saveQuiet } from "@/lib/alert-rules"

const f = (d: FormData, k: string) => String(d.get(k) ?? "")
const go = (q: string) => redirect(`/alerts/rules?${q}`)
const fail = (e: unknown) => `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}`

export async function saveRuleAction(d: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  let q = "ok=Saved. Anker uses it at its next check, within five minutes."
  try { await saveRule(s, { key: f(d, "key"), enabled: d.get("enabled") === "on", severity: f(d, "severity"), rate: f(d, "rate"), minCalls: f(d, "minCalls"), windowMin: f(d, "windowMin"), muteDays: f(d, "muteDays"), unmute: d.get("unmute") === "on", reason: f(d, "reason") }) } catch (e) { q = fail(e) }
  go(q)
}
export async function saveQuietAction(d: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  let q = "ok=Quiet hours saved."
  try { await saveQuiet(s, f(d, "start"), f(d, "end"), f(d, "reason")) } catch (e) { q = fail(e) }
  go(q)
}
