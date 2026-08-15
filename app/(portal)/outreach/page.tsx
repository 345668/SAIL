import { ComingSoon } from "@/components/coming-soon"

export const dynamic = "force-dynamic"

export default function OutreachPage() {
  return (
    <ComingSoon
      eyebrow="Data & growth"
      title="Send Center"
      description="The platform-level send / track / triage loop over the shared sending identity (vc@an-ker.de) and the cross-user inbox."
      migrating={[
        { name: "Outbox — drafts → Resend, open/click tracking", from: "/dashboard/send-center" },
        { name: "Reply triage — classify → approve → advance CRM", from: "/dashboard/send-center/replies" },
        { name: "Outreach agent — orchestrated DM sequences", from: "/dashboard/admin/agent" },
      ]}
    />
  )
}
