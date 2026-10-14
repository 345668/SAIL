import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { BANNED_PHRASES, hasDash, polishArticle, stripDashes, styleReport } from "./newsroom-style"
import { parseSkill } from "./newsroom-skill"

const EM = "—", EN = "–"

describe("dashes", () => {
  it("turns a clause dash into a comma and keeps the spacing right", () => {
    expect(stripDashes(`Funds raised less ${EM} again.`).text).toBe("Funds raised less, again.")
    expect(stripDashes(`Funds raised less${EM}again.`).text).toBe("Funds raised less, again.")
    expect(stripDashes(`Funds raised less ${EN} again.`).text).toBe("Funds raised less, again.")
  })
  it("turns a numeric range into 'to'", () => {
    expect(stripDashes(`Between 2020${EN}2024 and $5${EM}10M.`).text).toBe("Between 2020 to 2024 and $5 to 10M.")
  })
  it("does not double the punctuation or merge lines", () => {
    expect(stripDashes(`Done. ${EM} Next.`).text).toBe("Done. Next.")
    expect(stripDashes(`First line ${EM}\nSecond line`).text).toBe("First line\nSecond line")
    expect(stripDashes(`${EM} starts a line`).text).toBe("starts a line")
    expect(stripDashes(`a${EM}${EM}b`).text).not.toMatch(/,,/)
  })
  it("a spaced double hyphen counts, but a markdown rule, a table and a hyphenated word do not", () => {
    expect(stripDashes("one -- two").text).toBe("one, two")
    const table = "| a | b |\n|---|---|\n| 1 | 2 |"
    expect(stripDashes(table).text).toBe(table)
    expect(stripDashes("---\n").text).toBe("---\n")
    expect(stripDashes("early-stage, GP-led and well-known").text).toBe("early-stage, GP-led and well-known")
  })
  it("leaves code alone", () => {
    const code = "Use `a" + EM + "b` and\n```\nx " + EM + " y\n```\nthen " + EM + " done"
    const out = stripDashes(code).text
    expect(out).toContain("`a" + EM + "b`")
    expect(out).toContain("x " + EM + " y")
    expect(out).toContain("then, done")
  })
  it("counts what it removed and detects what remains", () => {
    expect(stripDashes(`a ${EM} b ${EM} c`).removed).toBe(2)
    expect(hasDash(`a ${EM} b`)).toBe(true)
    expect(hasDash(stripDashes(`a ${EM} b ${EN} c 1${EN}2`).text)).toBe(false)
  })
})

describe("the style report", () => {
  it("finds banned phrases as whole words, in any common form, and not inside other words", () => {
    const r = styleReport("We delve into the tapestry. Leveraging data, it unlocks gains. Thoroughly robust. In conclusion, go.")
    expect(r.bannedFound).toEqual(expect.arrayContaining(["delve", "tapestry", "robust", "in conclusion"]))
    expect(styleReport("A landscaper planted roots near the doors.").bannedFound).toEqual([])
    expect(styleReport("The fund will leverage its network").bannedFound).toContain("leverage")
  })
  it("counts exclamation marks and emoji", () => {
    expect(styleReport("Great! Really! \u{1F680}").exclamations).toBe(2)
    expect(styleReport("Great! \u{1F680}\u{1F4A1}").emoji).toBe(2)
  })
})

describe("polishing a whole article", () => {
  const draft = {
    headline: `Funds raised less ${EM} again`,
    subheadline: `LPs paused ${EN} briefly`,
    content: `## The numbers\n\nCommitments fell 2023${EN}2025 ${EM} a delve into the data.\n\n## Sources\n\n- Reuters ${EM} Fund raising slows ${EM} 12 Oct 2026`,
    suggestedTags: ["VC Funds", `lp ${EM} sentiment`],
  }
  it("cleans every field, lowercases tags and reports", () => {
    const { article, report } = polishArticle(draft)
    for (const v of [article.headline, article.subheadline, article.content, ...article.suggestedTags]) expect(hasDash(v)).toBe(false)
    expect(article.headline).toBe("Funds raised less, again")
    expect(article.content).toContain("2023 to 2025")
    expect(article.content).toContain("- Reuters, Fund raising slows, 12 Oct 2026")
    expect(article.suggestedTags).toEqual(["vc funds", "lp, sentiment"])
    expect(report.dashesRemoved).toBeGreaterThanOrEqual(7)
    expect(report.bannedFound).toContain("delve")
  })
  it("flags a headline over 70 characters", () => {
    expect(polishArticle({ ...draft, headline: "x".repeat(71) }).headlineTooLong).toBe(true)
    expect(polishArticle({ ...draft, headline: "x".repeat(70) }).headlineTooLong).toBe(false)
  })
})

describe("the skill file", () => {
  const raw = readFileSync("skills/newsroom-writer.md", "utf8")
  const skill = parseSkill(raw)
  it("reads its settings and body", () => {
    expect(skill).toMatchObject({ temperature: 0.4, maxTokens: 4096, fromFile: true })
    expect(skill.body).not.toContain("---\nname:")
    expect(skill.body).toMatch(/^# Role/)
  })
  it("lists every banned phrase the checker looks for, so the model and the check cannot drift apart", () => {
    const body = skill.body.toLowerCase()
    for (const w of BANNED_PHRASES) expect(body, w).toContain(w.toLowerCase())
  })
  it("states the hard rules the cleaner enforces", () => {
    expect(skill.body).toMatch(/Never use em dashes/)
    expect(skill.body).toMatch(/Output contract/)
    expect(skill.body).toMatch(/Do not invent quotes/)
  })
  it("falls back to sane settings for a file without frontmatter", () => {
    expect(parseSkill("Just rules.")).toMatchObject({ body: "Just rules.", temperature: 0.4, maxTokens: 4096 })
  })
})
