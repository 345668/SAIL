import { ComingSoon } from "@/components/coming-soon"

export const dynamic = "force-dynamic"

export default function SystemPage() {
  return (
    <ComingSoon
      eyebrow="Platform"
      title="System health"
      description="Infrastructure reachability and the live AI-router map — Postgres, Ollama, SearXNG, Marker, pgvector status, table counts."
      migrating={[{ name: "System health dashboard", from: "/dashboard/admin/system" }]}
    />
  )
}
