#!/usr/bin/env node
/**
 * Break-glass: remove a staff member's two-factor enrolment and revoke their sessions, so they can sign in with the
 * password and enrol again. For a lost phone with no recovery codes. Needs database access, which is the point: only
 * someone who already holds production credentials can run it.
 *
 *   NEON_DATABASE_URL=... node scripts/reset-mfa.mjs --email you@an-ker.de
 */
import { neon } from "@neondatabase/serverless"

const url = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL
const i = process.argv.indexOf("--email")
const email = i > 0 ? process.argv[i + 1] : ""
if (!url || !email) { console.error("usage: NEON_DATABASE_URL=... node scripts/reset-mfa.mjs --email someone@an-ker.de"); process.exit(1) }
const sql = neon(url)
const [staff] = await sql`SELECT id, email FROM company_staff WHERE lower(email) = lower(${email}) LIMIT 1`
if (!staff) { console.error("no such staff member"); process.exit(1) }
await sql`DELETE FROM staff_mfa WHERE staff_id = ${staff.id}`
const revoked = await sql`UPDATE staff_sessions SET revoked_at = now() WHERE staff_id = ${staff.id} AND revoked_at IS NULL RETURNING id`
await sql`INSERT INTO company_audit_log (staff_id, staff_email, action, target, detail) VALUES (${staff.id}, ${staff.email}, 'auth.mfa_reset', ${staff.id}, ${JSON.stringify({ by: "break-glass script", revokedSessions: revoked.length })}::jsonb)`
console.log(`Two-factor removed for ${staff.email}; ${revoked.length} session(s) revoked. They can sign in and enrol again.`)
