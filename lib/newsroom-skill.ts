import { readFile } from "node:fs/promises"
import path from "node:path"

/** The newsroom writer skill (skills/newsroom-writer.md): the same SKILL.md format as Anker's model skills. */
export interface Skill {
  body: string
  temperature: number
  maxTokens: number
  /** True when the file was read; false when the built-in fallback is in use. */
  fromFile: boolean
}

const FALLBACK = `You are the editor of Anker's public newsroom. Write plain, precise, evidence-led prose in short sentences and the active voice. Never use em dashes, en dashes or double hyphens (use a comma, colon, full stop or parentheses). No exclamation marks or emoji. Use only facts from the supplied sources and never invent a figure, quote or name. No filler words such as delve, landscape, leverage, robust, seamless or unlock. Open with the point, close with one concrete next step.`

let cache: Skill | null = null

export function parseSkill(raw: string): Skill {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const meta = new Map<string, string>()
  if (m) for (const line of m[1].split("\n")) { const k = line.match(/^([A-Za-z]+):\s*(.*)$/); if (k) meta.set(k[1], k[2].trim()) }
  const temp = Number(meta.get("temperature"))
  const max = Number(meta.get("maxTokens"))
  return {
    body: (m ? m[2] : raw).trim(),
    temperature: Number.isFinite(temp) && temp >= 0 && temp <= 1 ? temp : 0.4,
    maxTokens: Number.isInteger(max) && max >= 256 && max <= 8192 ? max : 4096,
    fromFile: true,
  }
}

export async function loadNewsroomSkill(): Promise<Skill> {
  if (cache) return cache
  try {
    cache = parseSkill(await readFile(path.join(process.cwd(), "skills", "newsroom-writer.md"), "utf8"))
  } catch (e) {
    console.error("[newsroom] skill file unavailable, using the built-in rules:", (e as Error).message)
    return { body: FALLBACK, temperature: 0.4, maxTokens: 4096, fromFile: false }
  }
  return cache
}
export const _resetSkillCache = () => { cache = null }
