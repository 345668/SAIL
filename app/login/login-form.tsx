"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, LogIn } from "lucide-react"

export function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Sign-in failed")
        return
      }
      router.replace(params.get("next") || "/")
      router.refresh()
    } catch {
      setError("Network error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-border bg-card p-6 space-y-4">
      <label className="block">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-[var(--accent)]"
          placeholder="you@an-ker.de"
        />
      </label>
      <label className="block">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mt-1 w-full h-10 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-[var(--accent)]"
          placeholder="••••••••"
        />
      </label>
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full h-10 rounded-md text-sm font-medium text-white inline-flex items-center justify-center gap-2 disabled:opacity-60"
        style={{ background: "var(--accent)" }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} Sign in
      </button>
    </form>
  )
}
