import { neon, type NeonQueryFunction } from "@neondatabase/serverless"

/**
 * The portal shares the platform Neon database (to administer it) but never
 * touches tenant Supabase auth. Lazily initialized so importing this module
 * (e.g. on the login page, which does no queries) never throws when the env is
 * momentarily unset. Tagged-template usage only: sql`SELECT ...`.
 */
let _sql: NeonQueryFunction<false, false> | null = null

function client(): NeonQueryFunction<false, false> {
  if (_sql) return _sql
  const url = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || ""
  if (!url) throw new Error("NEON_DATABASE_URL is not set")
  _sql = neon(url)
  return _sql
}

// Forward tagged-template calls to the lazily-created neon client.
export const sql = ((strings: TemplateStringsArray, ...values: any[]) =>
  client()(strings, ...values)) as NeonQueryFunction<false, false>
