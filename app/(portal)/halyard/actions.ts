"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { setHalyardSwitch } from "@/lib/halyard"

export async function switchAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  const on = String(f.get("on")) === "1"
  let q: string
  try { await setHalyardSwitch(s, on, String(f.get("reason") || "")); q = `ok=${encodeURIComponent(on ? "Halyard is on for every workspace whose plan includes it." : "Halyard is off. Live sessions stop now; people can still read, export and delete their calls.")}` }
  catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}` }
  redirect(`/halyard?${q}`)
}
