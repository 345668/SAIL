"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { acknowledge, addNote, resolve } from "@/lib/alerts"

const run = async (f: FormData, ok: string, fn: (s: NonNullable<Awaited<ReturnType<typeof getSession>>>, id: number) => Promise<void>) => {
  const s = await getSession(); if (!s) redirect("/login")
  let q = `ok=${encodeURIComponent(ok)}`
  try { await fn(s, Number(f.get("id"))) } catch (e) { q = `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}` }
  redirect(`/alerts?${q}`)
}
export const ack = async (f: FormData) => run(f, "Acknowledged. Reminders now come once a day.", (s, id) => acknowledge(s, id, String(f.get("note") || "")))
export const noteAction = async (f: FormData) => run(f, "Note added.", (s, id) => addNote(s, id, String(f.get("note") || "")))
export const resolveAction = async (f: FormData) => run(f, "Resolved. If the problem is still there it will reopen within a day.", (s, id) => resolve(s, id, { cause: String(f.get("cause") || ""), fix: String(f.get("fix") || "") }))
