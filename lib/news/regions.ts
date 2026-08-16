/**
 * Region taxonomy for news sourcing.
 *
 * Different news APIs use different country/region codes. We define a
 * single taxonomy that the UI surfaces (Global / NA / EMEA / APAC / MENA
 * / LatAm) and provider-specific mappings here so callers don't have to
 * memorise each API's ISO-3166 quirks.
 *
 * Coverage notes
 *   - Alpha Vantage NEWS_SENTIMENT is a single global feed filtered by
 *     `tickers` + `topics`; no country param. We just pass topics through.
 *   - Finnhub /news?category=general is global; /company-news is per-ticker.
 *     No region filter.
 *   - Marketaux supports `countries=us,gb,...` (ISO-2). Strong region story.
 *   - GNews / NewsAPI / NewsCatcher are similar to Marketaux.
 *   - SEC EDGAR is US-only by design.
 */

export const REGIONS = ["global", "na", "emea", "apac", "mena", "latam"] as const
export type Region = (typeof REGIONS)[number]

export interface RegionMeta {
  label: string
  /** What we surface in the UI. */
  description: string
  /** ISO-2 country codes Marketaux / NewsAPI use. */
  countryCodes: string[]
}

export const REGION_META: Record<Region, RegionMeta> = {
  global: {
    label: "Global",
    description: "All regions, all topics — broad financial news feed.",
    countryCodes: [],
  },
  na: {
    label: "North America",
    description: "US + Canada — VC, IPOs, M&A, late-stage rounds.",
    countryCodes: ["us", "ca"],
  },
  emea: {
    label: "EMEA",
    description: "Europe, Middle East, Africa — major VC hubs.",
    countryCodes: ["gb", "de", "fr", "nl", "se", "ch", "es", "it", "ae", "sa", "il", "za"],
  },
  apac: {
    label: "APAC",
    description: "Asia-Pacific — China, India, Singapore, Japan, Australia.",
    countryCodes: ["cn", "in", "sg", "jp", "au", "kr", "hk", "id", "my", "th", "vn", "ph"],
  },
  mena: {
    label: "MENA",
    description: "Middle East and North Africa — sovereign wealth, family offices.",
    countryCodes: ["ae", "sa", "qa", "kw", "bh", "om", "eg", "ma", "tn", "jo", "lb"],
  },
  latam: {
    label: "Latin America",
    description: "Brazil, Mexico, Colombia, Argentina, Chile.",
    countryCodes: ["br", "mx", "co", "ar", "cl", "pe", "uy"],
  },
}

/**
 * Standard topic vocabulary surfaced in the UI. The UI maps these to
 * provider-specific parameters via the provider modules.
 *
 * Curated for a VC / private-markets newsroom — not generic categories.
 */
export const TOPICS = [
  "venture_capital",
  "private_equity",
  "ipo",
  "mergers_and_acquisitions",
  "fundraising",
  "exits",
  "growth_rounds",
  "ai_infrastructure",
  "fintech",
  "climate_tech",
  "healthtech",
  "earnings",
  "regulation",
  "macro",
] as const
export type Topic = (typeof TOPICS)[number]

export const TOPIC_LABEL: Record<Topic, string> = {
  venture_capital:         "Venture capital",
  private_equity:          "Private equity",
  ipo:                     "IPOs",
  mergers_and_acquisitions:"M&A",
  fundraising:             "Fundraising",
  exits:                   "Exits & secondaries",
  growth_rounds:           "Growth rounds",
  ai_infrastructure:       "AI infrastructure",
  fintech:                 "Fintech",
  climate_tech:            "Climate tech",
  healthtech:              "Healthtech / biotech",
  earnings:                "Earnings",
  regulation:              "Regulation",
  macro:                   "Macro / markets",
}
