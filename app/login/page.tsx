import { redirect } from "next/navigation"
import { getSession } from "@/lib/auth"
import { LoginForm } from "./login-form"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  if (await getSession()) redirect("/")
  return (
    <div className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-4">
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
            Company Portal
          </div>
          <h1 className="font-display text-4xl tracking-[-0.02em] leading-none">Anker</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Platform administration. Staff access only —<br />separate from tenant accounts.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
