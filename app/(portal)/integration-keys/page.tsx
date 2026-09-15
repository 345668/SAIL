import { PageShell } from "@/components/page-shell"
import { INTEGRATION_KEY_NAMES, statusPayload } from "@/lib/integration-keys"
import { IntegrationKeysClient, type Status } from "./integration-keys-client"

export const dynamic = "force-dynamic"
export const metadata = { title: "Integration keys — Anker Portal" }

export default async function IntegrationKeysPage() {
  let initial: Status = { encryptionConfigured: false, keys: {} }
  let error: string | null = null
  try {
    initial = (await statusPayload()) as Status
  } catch (e: any) {
    error = e?.message || "load failed"
  }

  return (
    <PageShell
      eyebrow="Platform · Integrations"
      title="Integration keys"
      description="Third-party credentials the tenant app resolves at runtime — email, sanctions and company-registry lookups, e-signature and the document worker. A database value overrides the matching environment variable. Stored AES-256-GCM encrypted; values are never displayed after entry."
    >
      {error ? (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">
          Couldn&apos;t load key status: <span className="text-[var(--danger)]">{error}</span>
        </div>
      ) : (
        <IntegrationKeysClient initial={initial} names={[...INTEGRATION_KEY_NAMES]} />
      )}
    </PageShell>
  )
}
