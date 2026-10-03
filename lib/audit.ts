import { sql } from "./db"

/** Append to company_audit_log. Never throws: an audit write failure must not turn a refusal into an error page. */
export async function audit(action: string, who: { id?: string | null; email?: string | null }, target?: string | null, detail?: Record<string, unknown>): Promise<void> {
  try {
    await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail) VALUES (${who.id ?? null}, ${who.email ?? null}, ${action}, ${target ?? null}, ${detail ? JSON.stringify(detail) : null}::jsonb)`
  } catch (e) {
    console.error("[audit] write failed", action, (e as Error)?.message)
  }
}
