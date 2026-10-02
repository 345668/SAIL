"use client"
/**
 * Browser side of "attach / replace deck". Small files go through the relay as multipart;
 * anything above the hosted request limit is uploaded straight to private Blob (the relay
 * only carries the small token handshake and the final JSON) and then recorded by the tenant.
 * Mirrors the tenant's own console (lib/campaign/deck-attach-client.ts there).
 */
const MAX_BYTES = 25 * 1024 * 1024
const INLINE_MAX = 3 * 1024 * 1024
const prefix = (publicRef: string) => `founder-submissions/${publicRef}/`

export async function attachDeckFile(endpoint: string, publicRef: string, file: File): Promise<void> {
  if (file.size === 0) throw new Error("That file is empty.")
  if (file.size > MAX_BYTES) throw new Error("File exceeds 25 MB.")
  if (!/\.(pdf|pptx?)$/i.test(file.name)) throw new Error("Use a PDF or PowerPoint file.")

  if (file.size <= INLINE_MAX) {
    const fd = new FormData(); fd.set("deck", file)
    const res = await fetch(endpoint, { method: "POST", body: fd })
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Upload failed (${res.status})`)
    return
  }
  const { upload } = await import("@vercel/blob/client")
  let url: string
  try {
    const blob = await upload(`${prefix(publicRef)}deck-admin-${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`, file, {
      access: "private" as any, handleUploadUrl: endpoint, contentType: file.type || undefined,
    })
    url = blob.url
  } catch (e: any) { throw new Error(`Could not upload the deck: ${e?.message ?? "upload failed"}`) }
  const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ blobUrl: url }) })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Could not attach the deck (${res.status})`)
}
