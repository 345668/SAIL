// Static reference copy of the tenant AI router's task catalogue
// (lib/ai/model-router.ts). The portal edits the SAME shared-DB knob the tenant
// reads — system_settings key 'ai_router_v1' — so the two stay in lock-step
// without the portal importing tenant code. Keep this list in sync if the
// tenant adds/removes tasks; unknown tasks in the stored config are preserved
// on write, so drift never loses data.

export type Tier = "fast" | "balanced" | "deep"

export interface TaskDef {
  task: string
  tier: Tier
  label: string
  group: string
}

export const AI_TASKS: TaskDef[] = [
  // Outreach & matching
  { task: "reply_classify",   tier: "fast",     label: "Reply classifier",        group: "Outreach & matching" },
  { task: "dm_personalize",   tier: "fast",     label: "DM personalization",      group: "Outreach & matching" },
  { task: "ai_rationale",     tier: "fast",     label: "Why-this-investor line",  group: "Outreach & matching" },
  { task: "match_summary",    tier: "fast",     label: "Matchmaking summary",     group: "Outreach & matching" },
  // Documents
  { task: "doc_summary",      tier: "fast",     label: "Document summary",        group: "Documents" },
  { task: "deck_extract",     tier: "balanced", label: "Deck → profile JSON",     group: "Documents" },
  { task: "deck_critique",    tier: "deep",     label: "Founder deck critique",   group: "Documents" },
  { task: "fund_critique",    tier: "balanced", label: "LP fund critique",        group: "Documents" },
  // Data quality
  { task: "enrich_extract",   tier: "balanced", label: "Enrichment extract",      group: "Data quality" },
  { task: "deep_research",    tier: "deep",     label: "Deep research dossier",   group: "Data quality" },
  { task: "url_classify",     tier: "fast",     label: "URL classifier",          group: "Data quality" },
  { task: "investor_profile", tier: "balanced", label: "Investor profile",        group: "Data quality" },
  { task: "firm_lookup",      tier: "fast",     label: "Firm disambiguation",     group: "Data quality" },
  { task: "linkedin_extract", tier: "balanced", label: "LinkedIn extract",        group: "Data quality" },
  { task: "portfolio_search", tier: "fast",     label: "Portfolio search",        group: "Data quality" },
  // Campaign engine
  { task: "campaign_readiness", tier: "deep",     label: "Campaign readiness gate", group: "Campaign engine" },
  { task: "campaign_draft",     tier: "balanced", label: "Campaign email draft",    group: "Campaign engine" },
]

export const PROVIDERS = ["anthropic", "gemini", "openai", "mistral", "qwen", "ollama", "none"] as const
export type Provider = (typeof PROVIDERS)[number]

export interface AiRouterConfig {
  enabled: Record<string, boolean>
  modelOverride: Record<string, string>
  providerOverride: string | null
  providerStrict?: boolean
  [k: string]: unknown
}

export const EMPTY_AI_CONFIG: AiRouterConfig = {
  enabled: {},
  modelOverride: {},
  providerOverride: null,
  providerStrict: false,
}
