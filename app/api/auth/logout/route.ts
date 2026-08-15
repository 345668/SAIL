import { NextResponse } from "next/server"
import { endSession } from "@/lib/auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST() {
  await endSession()
  return NextResponse.json({ ok: true })
}
