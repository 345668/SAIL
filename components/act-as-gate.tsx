"use client"

import { useState } from "react"
import { UserCog } from "lucide-react"

/**
 * Subject picker for the user-scoped tools (outreach email, agents).
 *
 * These endpoints authenticate as a TENANT USER rather than an admin, so every
 * request needs a subject. The tool is withheld until one is chosen — a send or
 * an agent run must never be possible with an ambiguous "as who".
 *
 * The relay refuses these paths without a subject anyway (ACT_AS_REQUIRED in
 * lib/anker-proxy.ts); this makes it a deliberate choice in the UI rather than
 * an error after the fact.
 */
export function ActAsGate({ children }: { children: (actAs: string) => React.ReactNode }) {
  const [draft, setDraft] = useState("")
  const [actAs, setActAs] = useState("")

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
          <UserCog className="h-3.5 w-3.5" /> Runs as a tenant user
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          This tool acts as the user you name — including sending real email from
          their mailbox. The tenant app records every impersonation against your
          portal account.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tenant user id (UUID)"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-foreground/40"
          />
          <button
            onClick={() => setActAs(draft.trim())}
            disabled={!draft.trim() || draft.trim() === actAs}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background hover:bg-foreground/85 disabled:opacity-50"
          >
            {actAs ? "Switch user" : "Continue"}
          </button>
          {actAs && (
            <button
              onClick={() => { setActAs(""); setDraft("") }}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-card"
            >
              Clear
            </button>
          )}
        </div>
        {actAs && (
          <p className="mt-2 text-xs text-muted-foreground">
            Acting as <code className="font-mono">{actAs}</code>
          </p>
        )}
      </div>

      {actAs ? (
        children(actAs)
      ) : (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Choose the tenant user this tool should act as to continue.
        </div>
      )}
    </div>
  )
}
