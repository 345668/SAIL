import { ComingSoon } from "@/components/coming-soon"

export const dynamic = "force-dynamic"

export default function DataOpsPage() {
  return (
    <ComingSoon
      eyebrow="Data & growth"
      title="Data operations"
      description="Build and clean the global investor database — the pipeline behind every tenant’s Discover, Find-Investors, and Matchmaking."
      migrating={[
        { name: "CSV / XLSX imports", from: "/dashboard/imports" },
        { name: "Web crawler", from: "/dashboard/imports/crawl" },
        { name: "Enrichment", from: "/dashboard/imports/enrichment" },
        { name: "URL check", from: "/dashboard/imports/url-check" },
        { name: "Email verification", from: "/dashboard/send-center/deliverability" },
        { name: "Deep research", from: "/dashboard/admin/research" },
      ]}
    />
  )
}
