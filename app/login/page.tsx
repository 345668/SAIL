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
          <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-4">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: "var(--accent)" }} />
            Company Portal
          </div>
          <h1 className="font-display text-2xl tracking-tight">Anker platform administration</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Staff access only. This portal is separate from tenant accounts.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
