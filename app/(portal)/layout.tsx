import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { PortalSidebar } from "@/components/portal-sidebar"

export const dynamic = "force-dynamic"

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Real verification (signature + expiry) in the Node runtime. Middleware only
  // did a coarse cookie-presence check at the edge.
  const staff = await getSession()
  if (!staff) redirect("/login")

  return (
    <div className="flex min-h-screen">
      <PortalSidebar staff={{ email: staff.email, name: staff.name, role: staff.role }} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  )
}
