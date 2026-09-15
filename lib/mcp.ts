import { createHash } from "node:crypto"

/**
 * Hash an MCP bearer token for storage/lookup.
 *
 * MUST stay byte-identical to Anker's lib/mcp/auth.ts (`sha256` → exported as
 * `hashMcpToken`): the tenant app's MCP server (/api/mcp) authenticates by
 * hashing the presented bearer and matching mcp_tokens.token_hash. Any drift
 * here silently invalidates every token issued from this portal.
 *
 * Only the hash is ever persisted; the raw token is shown once at issue time.
 */
export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}
