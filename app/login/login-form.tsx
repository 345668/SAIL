"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, LogIn, ShieldCheck } from "lucide-react"

type Step = "password" | "enroll" | "verify" | "codes"

const field = "mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-[var(--accent)]"
const label = "text-[11px] font-mono uppercase tracking-wider text-muted-foreground"
const primary = "w-full h-10 rounded-md text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"

export function LoginForm({ resume = null }: { resume?: "enroll" | "verify" | null }) {
  const router = useRouter()
  const params = useSearchParams()
  const [step, setStep] = useState<Step>(resume ?? "password")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null)
  const [backup, setBackup] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finish = () => { router.replace(params.get("next") || "/"); router.refresh() }

  async function post(url: string, body?: unknown) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || "Request failed"); return null }
      return data
    } catch { setError("Network error"); return null } finally { setBusy(false) }
  }

  async function startEnrol() {
    const d = await post("/api/auth/mfa/setup")
    if (d) { setSetup(d); setStep("enroll") }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    const d = await post("/api/auth/login", { email, password })
    if (!d) return
    setPassword("")
    if (d.next === "verify") setStep("verify")
    else await startEnrol()
  }

  async function submitEnable(e: React.FormEvent) {
    e.preventDefault()
    const d = await post("/api/auth/mfa/enable", { code })
    if (d) { setBackup(d.backupCodes || []); setCode(""); setStep("codes") }
  }

  async function submitVerify(e: React.FormEvent) {
    e.preventDefault()
    const d = await post("/api/auth/mfa/verify", { code })
    if (d) finish()
  }

  const submitStyle = { background: "var(--primary)", color: "var(--primary-foreground)" }

  if (step === "password") {
    return (
      <form onSubmit={submitPassword} className="card-elev rounded-2xl border border-border p-6 space-y-4">
        <label className="block"><span className={label}>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} placeholder="you@an-ker.de" /></label>
        <label className="block"><span className={label}>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={field} placeholder="••••••••" /></label>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <button type="submit" disabled={busy} className={primary} style={submitStyle}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} Sign in
        </button>
      </form>
    )
  }

  if (step === "verify") {
    return (
      <form onSubmit={submitVerify} className="card-elev rounded-2xl border border-border p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm"><ShieldCheck className="w-4 h-4" /> Enter the 6-digit code from your authenticator app.</div>
        <label className="block"><span className={label}>Code</span>
          <input inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required className={field} placeholder="123456" /></label>
        <p className="text-xs text-muted-foreground">Lost your phone? Enter one of your recovery codes instead.</p>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <button type="submit" disabled={busy} className={primary} style={submitStyle}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Verify
        </button>
      </form>
    )
  }

  if (step === "enroll") {
    return (
      <form onSubmit={submitEnable} className="card-elev rounded-2xl border border-border p-6 space-y-4">
        <div className="text-sm font-medium">Set up two-factor sign-in</div>
        <p className="text-sm text-muted-foreground">Two-factor is required for company staff. In an authenticator app (1Password, Authy, Google Authenticator), add an account with this key, then enter the 6-digit code it shows.</p>
        {setup ? (
          <>
            <div className="rounded-md border border-border bg-background p-3">
              <div className={label}>Setup key</div>
              <div className="mt-1 font-mono text-sm break-all select-all">{setup.secret}</div>
              <a href={setup.uri} className="mt-2 inline-block text-xs underline text-muted-foreground">Open in authenticator app</a>
            </div>
            <label className="block"><span className={label}>Code from the app</span>
              <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required className={field} placeholder="123456" /></label>
          </>
        ) : (
          <button type="button" onClick={startEnrol} disabled={busy} className={primary} style={submitStyle}>Generate setup key</button>
        )}
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        {setup && (
          <button type="submit" disabled={busy} className={primary} style={submitStyle}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Confirm and turn on
          </button>
        )}
      </form>
    )
  }

  return (
    <div className="card-elev rounded-2xl border border-border p-6 space-y-4">
      <div className="text-sm font-medium">Two-factor is on. Save your recovery codes.</div>
      <p className="text-sm text-muted-foreground">Each code works once if you lose your phone. They are shown now and never again. Store them somewhere safe (a password manager).</p>
      <div className="rounded-md border border-border bg-background p-3 font-mono text-sm grid grid-cols-2 gap-x-4 gap-y-1 select-all">
        {backup.map((c) => <div key={c}>{c}</div>)}
      </div>
      <button type="button" onClick={finish} className={primary} style={submitStyle}>I have saved them, continue</button>
    </div>
  )
}
