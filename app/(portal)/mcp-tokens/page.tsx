import { PageShell } from "@/components/page-shell"
import { McpTokensClient } from "./mcp-tokens-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "MCP Tokens — Anker Portal" }

export default function McpTokensPage() {
  return (
    <PageShell
      eyebrow="Platform · MCP"
      title="MCP access tokens"
      description="Issue and revoke bearer tokens for the Anker MCP server (/api/mcp). Each token sets the user the tools act as, whether it is read-only, and an optional tool allowlist. The raw token is shown once — only its hash is stored."
    >
      <McpTokensClient />
    </PageShell>
  )
}
