"use server"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { ControlError } from "@/lib/tenant-control"
import { StepUpError, requireStepUp } from "@/lib/step-up"
import { cancelTenantRequest, requestDryRun, requestExport, scheduleErasure } from "@/lib/tenant-requests"

async function who() { const s = await getSession(); if (!s) redirect("/login"); return s }
const back = (id: string, q: string) => redirect(`/organizations/${encodeURIComponent(id)}/requests?${q}`)
const fail = (id: string, e: unknown) => back(id, `err=${encodeURIComponent(e instanceof ControlError || e instanceof StepUpError ? e.message : "Something went wrong. Nothing was changed.")}`)

export async function exportAction(fd: FormData) { const s = await who(); const id = String(fd.get("orgId") || ""); try { await requestExport(s, id) } catch (e) { fail(id, e) } back(id, "ok=Export built. The workspace's owners were emailed the download link.") }
export async function dryRunAction(fd: FormData) { const s = await who(); const id = String(fd.get("orgId") || ""); try { await requestDryRun(s, id) } catch (e) { fail(id, e) } back(id, "ok=Dry run taken. Nothing was deleted.") }
export async function cancelAction(fd: FormData) { const s = await who(); const id = String(fd.get("orgId") || ""); try { await cancelTenantRequest(s, id, String(fd.get("requestId") || "")) } catch (e) { fail(id, e) } back(id, "ok=Cancelled.") }

export async function scheduleAction(fd: FormData) {
  const s = await who(); const id = String(fd.get("orgId") || "")
  try {
    const ip = ((await headers()).get("x-forwarded-for") || "").split(",")[0].trim() || "0.0.0.0"
    await requireStepUp(s, String(fd.get("code") || ""), ip, "tenant.erasure.schedule")
    await scheduleErasure(s, id, String(fd.get("requestId") || ""), String(fd.get("confirmName") || ""))
  } catch (e) { fail(id, e) }
  back(id, "ok=Scheduled. The owners were emailed, and it can be cancelled until it runs.")
}
