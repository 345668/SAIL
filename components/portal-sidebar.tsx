"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard, Building2, Users, KeyRound, Bot, Database, Send,
  Newspaper, HeartPulse, ScrollText, CreditCard, LogOut, ShieldCheck, Plug, Puzzle, Plug2, Telescope, Globe, FileUp, LinkIcon, MailCheck, Wand2, Inbox, Mail,
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
      { label: "MCP tokens", href: "/mcp-tokens", icon: Plug },
      { label: "Extension tokens", href: "/extension-tokens", icon: Puzzle },
      { label: "Integration keys", href: "/integration-keys", icon: Plug2 },
      { label: "AI config", href: "/ai-config", icon: Bot },
      { label: "System health", href: "/system", icon: HeartPulse },
    ],
  },
  {
    heading: "Data & growth",
    items: [
      { label: "Data ops", href: "/data-ops", icon: Database },
      { label: "Deep research", href: "/research", icon: Telescope },
      { label: "Web crawler", href: "/crawl", icon: Globe },
      { label: "CSV imports", href: "/imports", icon: FileUp },
      { label: "AI enrichment", href: "/enrichment", icon: Wand2 },
      { label: "Reply inbox", href: "/inbox", icon: Inbox },
      { label: "Outreach outbox", href: "/email", icon: Mail },
      { label: "Outreach agents", href: "/agent", icon: Bot },
      { label: "URL health", href: "/url-check", icon: LinkIcon },
      { label: "Email verification", href: "/email-check", icon: MailCheck },
      { label: "Send Center", href: "/outreach", icon: Send },
      { label: "Newsroom CMS", href: "/newsroom", icon: Newspaper },
    ],
  },
  {
    heading: "Governance",
    items: [
      { label: "Audit log", href: "/audit", icon: ScrollText },
      { label: "Billing & credits", href: "/billing", icon: CreditCard },
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
      <div className="px-5 py-6 border-b border-border">
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
          Company Portal
        </div>
        <div className="mt-1.5 font-display text-2xl leading-none tracking-[-0.02em]">Anker</div>
        <div className="mt-1 text-[11px] text-muted-foreground">Platform administration</div>
      </div>

      <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-6">
        {NAV.map((group) => (
          <div key={group.heading}>
            <h3 className="px-2.5 mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/80">
              {group.heading}
            </h3>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex items-center gap-2.5 rounded-lg pl-3.5 pr-2.5 py-2 text-sm transition-colors ${
                        active
                          ? "bg-[var(--accent-soft)] text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]"
                      }`}
                    >
                      <span
                        className={`absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full transition-opacity ${active ? "opacity-100" : "opacity-0"}`}
                        style={{ background: "var(--accent)" }}
                      />
                      <item.icon className={`w-4 h-4 shrink-0 ${active ? "" : "opacity-80 group-hover:opacity-100"}`} />
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
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--accent)" }} />
          <span className="truncate">{staff.name || staff.email}</span>
          <span className="ml-auto font-mono text-[9px] uppercase tracking-wider border border-border rounded px-1 py-0.5">{staff.role}</span>
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
