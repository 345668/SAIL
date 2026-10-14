/**
 * Anker house style for newsroom drafts (skills/newsroom-writer.md). The model is told the rules; this enforces the mechanical ones after it
 * answers, so a slip never reaches the editor, and reports the judgement ones (banned words) for a human to decide.
 */

/** Phrases the skill forbids. A test keeps this list and the skill file in step. */
export const BANNED_PHRASES = [
  "delve", "tapestry", "landscape", "realm", "testament", "pivotal", "crucial", "vibrant", "paramount", "unparalleled", "meticulous", "holistic",
  "seamless", "robust", "cutting-edge", "game-changer", "game-changing", "revolutionize", "revolutionary", "transformative", "unlock", "leverage",
  "harness", "empower", "elevate", "foster", "underscore", "navigate", "journey", "synergy", "ever-evolving", "fast-paced world", "in today's world",
  "in today's digital age", "at the end of the day", "it is worth noting", "it's important to note", "in conclusion", "to sum up", "furthermore",
  "moreover", "dive into", "deep dive", "shed light on", "a myriad of", "plays a crucial role", "stands as a testament", "take it to the next level",
] as const

const DASHES = /[‒–—―−]/ // figure dash, en dash, em dash, horizontal bar, minus sign
const DASH_G = /[‒–—―−]/g

/**
 * Removes em dashes, en dashes and double hyphens from prose. A range between numbers becomes "to" ("2020 to 2024"); any other dash becomes a
 * comma (a clause break). Code fences and inline code are left alone, and so are single hyphens inside words.
 */
export function stripDashes(text: string): { text: string; removed: number } {
  let removed = 0
  const range = /(\d)[ \t]*[\u2012\u2013\u2014\u2015\u2212][ \t]*(\d)/g
  // A double hyphen only counts when it sits between words with spaces, so markdown rules and table separators (---) are left alone.
  const dash = /[ \t]*[‒–—―−][ \t]*|(?<=\w)[ \t]+--+[ \t]+(?=\w)/g
  const fix = (seg: string) =>
    seg
      .replace(range, (_m, x, y) => (removed++, `${x} to ${y}`))
      .replace(dash, (m, off: number, all: string) => {
        removed++
        const before = all[off - 1]
        const after = all[off + m.length]
        // At a line edge there is nothing to join: drop it. After punctuation a comma would double up: a space is enough.
        if (before === undefined || before === "\n" || after === undefined || after === "\n") return ""
        if (/[,.;:!?]/.test(before)) return " "
        return ", "
      })
  // Split out code so it is never touched: ``` fences first, then `inline`.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return { text: parts.map((p, i) => (i % 2 === 1 ? p : fix(p))).join(""), removed }
}

export interface StyleReport {
  dashesRemoved: number
  /** Banned phrases still present (whole-word match, case-insensitive). The editor decides what to do. */
  bannedFound: string[]
  exclamations: number
  emoji: number
}

const EMOJI = /\p{Extended_Pictographic}/gu

export function styleReport(text: string, removed = 0): StyleReport {
  const lower = text.toLowerCase()
  const found = BANNED_PHRASES.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(s|d|ed|ing|es)?($|[^a-z])`, "i").test(lower))
  return { dashesRemoved: removed, bannedFound: [...found], exclamations: (text.match(/!/g) ?? []).length, emoji: (text.match(EMOJI) ?? []).length }
}

export interface Article {
  headline: string
  subheadline: string
  content: string
  suggestedTags: string[]
}

/** Cleans every field of a draft and reports what is left for the editor. Marks the first headline over 70 characters, which the skill forbids. */
export function polishArticle<T extends Article>(a: T): { article: T; report: StyleReport; headlineTooLong: boolean } {
  let removed = 0
  const clean = (s: string) => {
    const r = stripDashes(String(s ?? ""))
    removed += r.removed
    return r.text.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim()
  }
  const article = {
    ...a,
    headline: clean(a.headline),
    subheadline: clean(a.subheadline),
    content: clean(a.content),
    suggestedTags: a.suggestedTags.map((t) => clean(t).toLowerCase()).filter(Boolean),
  }
  const report = styleReport(`${article.headline}\n${article.subheadline}\n${article.content}`, removed)
  return { article, report, headlineTooLong: article.headline.length > 70 }
}

export const hasDash = (s: string) => DASHES.test(s) || /\w[ \t]+--+[ \t]+\w/.test(s)
export { DASH_G }
