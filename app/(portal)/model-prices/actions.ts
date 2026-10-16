"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { savePrice } from "@/lib/model-prices"

export async function savePriceAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const model = String(f.get("model") || "")
  let q = `ok=${encodeURIComponent(`Saved the price for ${model}. It counts from the next AI call.`)}`
  try { await savePrice(s, { model, priceIn: String(f.get("priceIn") || ""), priceOut: String(f.get("priceOut") || ""), verified: f.get("verified") === "on", note: String(f.get("note") || "") }) }
  catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong.")}` }
  redirect(`/model-prices?${q}`)
}
