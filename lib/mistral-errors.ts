/** What went wrong at Mistral, in words an editor can act on: the status, Mistral's own message, and the usual cause. */
export function mistralProblem(status: number, body: string): string {
  const html = /<html|cloudflare|attention required/i.test(body)
  let msg = ""
  try {
    const j = JSON.parse(body)
    const m = j?.message ?? j?.detail ?? j?.error?.message ?? j?.error
    msg = typeof m === "string" ? m : m ? JSON.stringify(m) : ""
  } catch {
    msg = html ? "" : body.replace(/\s+/g, " ").trim()
  }
  msg = msg.slice(0, 200)
  const why =
    html ? "Mistral's edge network blocked this request (a Cloudflare page, not an API answer). Try again in a minute; if it repeats, ask Mistral support to allow Vercel's addresses for this key."
    : status === 401 ? "The stored key was not recognised. Replace it under Platform API keys."
    : status === 403 ? "Mistral refused this key. It is usually revoked, restricted to another product (for example a Codestral-only key), or the workspace has no active plan. Check the key in the Mistral console, then replace it under Platform API keys."
    : status === 402 || status === 429 ? "Mistral says the account is out of credit or rate limited. Check billing in the Mistral console."
    : status === 404 ? "Mistral does not know this model for the key. Set NEWSROOM_MISTRAL_MODEL to one the key can use."
    : ""
  return `Mistral ${status}${msg ? `: ${msg}` : ""}${why ? `. ${why}` : ""}`
}
