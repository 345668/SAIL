"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard, Building2, Users, KeyRound, Bot, Database, Send,
  Newspaper, HeartPulse, ScrollText, CreditCard, LogOut, ShieldCheck,
} from "lucide-react"

const NAV: { heading: string; items: { label: string; href: string; icon: any; soon?: boolean }[] }[] = [
  {
    heading: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Organizations", href: "/organizations", icon: Building2 },
      { label: "Users & roles", href: "/users", icon: Users },
    ],
  },
  {
    heading: "Platform",
    items: [
      { label: "Platform API keys", href: "/platform-keys", icon: KeyRound },
      { label: "AI config", href: "/ai-config", icon: Bot, soon: true },
      { label: "System health", href: "/system", icon: HeartPulse, soon: true },
    ],
  },
  {
    heading: "Data & growth",
    items: [
      { label: "Data ops", href: "/data-ops", icon: Database, soon: true },
      { label: "Send Center", href: "/outreach", icon: Send, soon: true },
      { label: "Newsroom CMS", href: "/newsroom", icon: Newspaper, soon: true },
    ],
  },
  {
    heading: "Governance",
    items: [
      { label: "Audit log", href: "/audit", icon: ScrollText },
      { label: "Billing & credits", href: "/billing", icon: CreditCard, soon: true },
    ],
  },
]

export function PortalSidebar({ staff }: { staff: { email: string; name: string | null; role: string } }) {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" })
    router.replace("/login")
    router.refresh()
  }

  return (
    <aside className="w-64 shrink-0 border-r border-border min-h-screen flex flex-col bg-card">
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "var(--accent)" }} />
          Company Portal
        </div>
        <div className="mt-1 font-display text-lg tracking-tight">Anker platform</div>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
        {NAV.map((group) => (
          <div key={group.heading}>
            <h3 className="px-2 mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {group.heading}
            </h3>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                        active ? "bg-[var(--accent)]/15 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
                      }`}
                    >
                      <item.icon className="w-4 h-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.soon && (
                        <span className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1 py-0.5">
                          soon
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="truncate">{staff.name || staff.email}</span>
          <span className="ml-auto font-mono text-[9px] uppercase tracking-wider border border-border rounded px-1">{staff.role}</span>
        </div>
        <button
          onClick={logout}
          className="mt-1 w-full flex items-center gap-2 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/5"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </div>
    </aside>
  )
}
