"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { saveBill } from "@/lib/unit-economics"

export async function saveBillAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  let q = `ok=${encodeURIComponent("Saved the bill.")}`
  try { await saveBill(s, { month: String(f.get("month") || ""), provider: String(f.get("provider") || ""), amountUsd: String(f.get("amountUsd") || ""), note: String(f.get("note") || "") }) }
  catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong.")}` }
  redirect(`/unit-economics?${q}`)
}
