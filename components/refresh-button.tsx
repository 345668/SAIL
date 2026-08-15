"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { RotateCw, Loader2 } from "lucide-react"

export function RefreshButton({ label = "Refresh" }: { label?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md border border-border text-sm hover:border-[var(--accent)] disabled:opacity-50"
    >
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} {label}
    </button>
  )
}
