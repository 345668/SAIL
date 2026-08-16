import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { listProviders, primeNewsKeyCache } from "@/lib/news/providers"
import { REGIONS, REGION_META, TOPICS, TOPIC_LABEL } from "@/lib/news/regions"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  const staff = await getSession()
  if (!staff) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  await primeNewsKeyCache()
  return NextResponse.json({
    providers: listProviders(),
    regions: REGIONS.map((id) => ({ id, ...REGION_META[id] })),
    topics: TOPICS.map((id) => ({ id, label: TOPIC_LABEL[id] })),
  })
}
