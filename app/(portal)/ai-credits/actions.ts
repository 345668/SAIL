"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { adjustCredits, grantCredits } from "@/lib/ai-credits"

export async function creditAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const org = String(f.get("org") || "").trim(), kind = String(f.get("kind") || "")
  let q: string
  try {
    const amount = Number(f.get("amount")), reason = String(f.get("reason") || "")
    if (kind === "grant") { const d = String(f.get("days") || "").trim(); await grantCredits(s, org, amount, d === "" ? null : Number(d), reason); q = `ok=${encodeURIComponent(`Granted $${amount.toFixed(2)}. It covers spend beyond the monthly allowance.`)}` }
    else if (kind === "adjust") { await adjustCredits(s, org, amount, reason); q = `ok=${encodeURIComponent("Adjusted.")}` }
    else throw new ControlError("Unknown action.")
  } catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}` }
  redirect(`/ai-credits?org=${encodeURIComponent(org)}&${q}`)
}
