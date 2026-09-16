"use client"

import { ActAsGate } from "@/components/act-as-gate"
import { AgentClient } from "./agent-client"

export function AgentFrame() {
  return <ActAsGate>{(actAs) => <AgentClient actAs={actAs} />}</ActAsGate>
}
