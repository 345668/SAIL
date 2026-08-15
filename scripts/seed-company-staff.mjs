#!/usr/bin/env node
/**
 * Seed (or update) a company-portal staff account. YOU run this with YOUR OWN
 * password — it is never stored or transmitted anywhere but the hash in the DB.
 *
 *   NEON_DATABASE_URL=... node scripts/seed-company-staff.mjs \
 *     --email you@an-ker.de --name "You" --role superadmin
 *
 * The password is read from the STAFF_PASSWORD env var, or prompted (hidden).
 * Requires the 2026-08-15-company-portal.sql migration to have been applied.
 */
import { neon } from "@neondatabase/serverless"
import { randomBytes, scryptSync } from "crypto"
import { createInterface } from "readline"

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const stdout = process.stdout
    rl.question(question, (answer) => { rl.close(); stdout.write("\n"); resolve(answer) })
    rl._writeToOutput = () => stdout.write("*")
  })
}

async function main() {
  const url = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL
  if (!url) { console.error("Set NEON_DATABASE_URL"); process.exit(1) }

  const email = arg("email")
  const name = arg("name", null)
  const role = arg("role", "superadmin")
  if (!email) { console.error("Usage: --email you@an-ker.de [--name ..] [--role staff|admin|superadmin]"); process.exit(1) }
  if (!["staff", "admin", "superadmin"].includes(role)) { console.error("role must be staff|admin|superadmin"); process.exit(1) }

  const password = process.env.STAFF_PASSWORD || (await promptHidden(`Password for ${email}: `))
  if (!password || password.length < 10) { console.error("Password must be at least 10 characters."); process.exit(1) }

  const sql = neon(url)
  const password_hash = hashPassword(password)
  await sql`
    INSERT INTO company_staff (email, name, role, password_hash)
    VALUES (${email}, ${name}, ${role}, ${password_hash})
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash, disabled = false`
  console.log(`✓ Company staff ready: ${email} (${role})`)
}

main().catch((e) => { console.error(e); process.exit(1) })
