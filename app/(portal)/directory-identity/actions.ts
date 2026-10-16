"use server"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { decide, reopen, runDetectionNow } from "@/lib/directory-identity"

const fail = (e: unknown) => `err=${encodeURIComponent(e instanceof ControlError ? e.message : "Something went wrong. Nothing was changed.")}`
const back = (f: FormData, q: string) => redirect(`/directory-identity?kind=${encodeURIComponent(String(f.get("kind") || "firm"))}&tier=${encodeURIComponent(String(f.get("tier") || ""))}&status=${encodeURIComponent(String(f.get("status") || "open"))}&page=${encodeURIComponent(String(f.get("page") || "0"))}&${q}`)

export async function decideAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  let q = "ok=Recorded."
  try { await decide(s, Number(f.get("id")), String(f.get("decision") || ""), { parentId: String(f.get("parent") || "") || undefined, reason: String(f.get("reason") || "") }) } catch (e) { q = fail(e) }
  back(f, q)
}
export async function reopenAction(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  let q = "ok=Reopened."
  try { await reopen(s, Number(f.get("id")), String(f.get("reason") || "")) } catch (e) { q = fail(e) }
  back(f, q)
}
export async function runNow(f: FormData) {
  const s = await getSession(); if (!s) redirect("/login")
  let q = ""
  try { const r = await runDetectionNow(s); q = `ok=${encodeURIComponent(`Detection finished: ${r.firms.toLocaleString()} firm pairs and ${r.people.toLocaleString()} person pairs found.`)}` } catch (e) { q = fail(e) }
  back(f, q)
}
