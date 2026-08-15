import { ComingSoon } from "@/components/coming-soon"

export const dynamic = "force-dynamic"

export default function BillingPage() {
  return (
    <ComingSoon
      eyebrow="Governance"
      title="Billing & credits"
      description="Platform cost monitoring — AI-router spend, storage, seats — and, later, per-org plans and invoicing."
      migrating={[{ name: "Billing & credits", from: "/dashboard/admin/billing (stub)" }]}
    />
  )
}
