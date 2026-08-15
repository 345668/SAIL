import { ComingSoon } from "@/components/coming-soon"

export const dynamic = "force-dynamic"

export default function NewsroomPage() {
  return (
    <ComingSoon
      eyebrow="Data & growth"
      title="Newsroom CMS"
      description="Author and publish the company’s own public newsroom at an-ker.de/newsroom. Not tenant content — the platform’s marketing surface."
      migrating={[
        { name: "Article CMS — draft / publish / archive, AI first draft", from: "/dashboard/content" },
        { name: "News sources", from: "/dashboard/content/sources" },
        { name: "News API keys", from: "/dashboard/content/api-keys" },
      ]}
    />
  )
}
