import { ComingSoon } from "@/components/coming-soon"

export const dynamic = "force-dynamic"

export default function AiConfigPage() {
  return (
    <ComingSoon
      eyebrow="Platform"
      title="AI config"
      description="The global AI router — force a provider, override the model per task, or switch a task off. Affects every AI call across the whole platform."
      migrating={[
        { name: "Provider force + per-task model overrides", from: "/dashboard/admin/ai-config" },
        { name: "Task on/off switches", from: "/dashboard/admin/ai-config" },
      ]}
    />
  )
}
