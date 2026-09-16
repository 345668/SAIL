"use client"

import { ActAsGate } from "@/components/act-as-gate"
import { EmailClient } from "./email-client"

export function EmailFrame() {
  return <ActAsGate>{(actAs) => <EmailClient actAs={actAs} />}</ActAsGate>
}
