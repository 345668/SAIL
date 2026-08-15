#!/usr/bin/env node
/**
 * Self-contained migration runner for the admin portal. Applies a .sql file
 * against NEON_DATABASE_URL, one statement at a time (neon http is single-stmt).
 * Respects '…' string literals and $$…$$ dollar-quotes; strips full-line comments.
 *
 *   NEON_DATABASE_URL=... node scripts/migrate.mjs db/001-init.sql
 */
import { neon } from "@neondatabase/serverless"
import { readFileSync } from "fs"

const file = process.argv[2] || "db/001-init.sql"
const url = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL
if (!url) { console.error("Set NEON_DATABASE_URL"); process.exit(1) }

function splitSql(src) {
  const out = []
  let buf = "", inSingle = false, dollar = null
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (dollar) { buf += c; if (src.startsWith(dollar, i)) { buf += dollar.slice(1); i += dollar.length - 1; dollar = null } continue }
    if (inSingle) { buf += c; if (c === "'") inSingle = false; continue }
    if (c === "'") { inSingle = true; buf += c; continue }
    if (c === "$") { const m = src.slice(i).match(/^\$[a-zA-Z0-9_]*\$/); if (m) { dollar = m[0]; buf += m[0]; i += m[0].length - 1; continue } }
    if (c === ";") { out.push(buf); buf = ""; continue }
    buf += c
  }
  if (buf.trim()) out.push(buf)
  return out
}

const raw = readFileSync(file, "utf8")
const clean = raw.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n")
const stmts = splitSql(clean).map((s) => s.trim()).filter(Boolean)
const sql = neon(url)

console.log(`Applying ${stmts.length} statement(s) from ${file}…`)
for (let i = 0; i < stmts.length; i++) {
  try {
    await sql.query(stmts[i])
    console.log(`  [${i + 1}/${stmts.length}] OK`)
  } catch (e) {
    console.error(`  [${i + 1}/${stmts.length}] ERR: ${e.message}`)
    process.exit(1)
  }
}
console.log("✓ done")
