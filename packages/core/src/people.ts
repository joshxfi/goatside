/**
 * Finds words in a description that might be people, so a decision model
 * only has to judge candidates (is "x" a person? did they owe you?) rather
 * than extract them. Over-collecting is fine: "grab to bgc" yields "bgc",
 * and the model says it's a place.
 */

export interface KnownPerson {
  id: string
  name: string
  aliases: string[]
}

export interface NameCandidate {
  /** Display form, e.g. "Tita Mel". */
  name: string
  /** Set when the name matches someone the owner already has. */
  personId: string | null
}

/** Words that introduce a person: "paid by x", "dinner w/ x", "utang ni x". */
const CUES =
  "with w/ kasama by from to for kay ni si kina owe owes owed lent lend borrowed utang bayad paid pinahiram sabay".split(
    " "
  )
const CUE = new RegExp(
  `(?:^|\\s)(?:${CUES.map((c) => c.replace("/", "\\/")).join("|")})(?=\\s)`,
  "giu"
)

/** Joins names in a list: "x and y", "x, y & z", "x at y". */
const JOINER = /^(?:and|at|&|,)$/iu

/** Titles that belong with the next word: "tita mel", "kuya ben". */
const TITLES = new Set(
  "tita tito lola lolo kuya ate mama papa nanay tatay sir maam ma'am dr doc".split(
    " "
  )
)

/** Common words after a cue that are never a person. */
const NOT_NAMES = new Set(
  `me my myself i ako akin amin us them him her it the a an this that
  work office home bahay school lunch dinner breakfast merienda coffee food
  today yesterday kahapon ngayon tomorrow bukas everyone all friends family
  barkada group cash gcash maya card bank month week year rent bill
  hatian hati split kkb libre treat share`
    .split(/\s+/)
    .filter(Boolean)
    .concat(CUES)
)

const WORD = /^[\p{L}][\p{L}'.-]*$/u

const display = (name: string) =>
  name.replace(
    /(^|\s)(\p{L})/gu,
    (_, space: string, letter: string) => space + letter.toUpperCase()
  )

function namesAfterCues(description: string): string[] {
  const found: string[] = []
  for (const match of description.matchAll(CUE)) {
    const rest = description
      .slice((match.index ?? 0) + match[0].length)
      .replace(/,/g, " , ")
      .split(/\s+/)
      .filter(Boolean)
    let i = 0
    while (i < rest.length) {
      const word = rest[i]?.toLowerCase().replace(/['’]s$/u, "") ?? ""
      if (!WORD.test(word) || NOT_NAMES.has(word)) break
      let name = word
      const next = rest[i + 1]?.toLowerCase() ?? ""
      if (TITLES.has(word) && WORD.test(next) && !JOINER.test(next)) {
        name = `${word} ${next}`
        i++
      }
      found.push(name)
      i++
      // Continue only through a list ("x and y"); anything else ends it.
      if (!JOINER.test(rest[i] ?? "")) break
      i++
    }
  }
  return found
}

const MAX_CANDIDATES = 4

/** Possible people in a description, in the order they're mentioned. */
export function nameCandidates(
  description: string,
  known: KnownPerson[] = []
): NameCandidate[] {
  const text = ` ${description.toLowerCase()} `
  const byName = new Map<string, NameCandidate>()
  const lookup = new Map<string, KnownPerson>()
  for (const person of known) {
    for (const name of [person.name, ...person.aliases]) {
      lookup.set(name.trim().toLowerCase(), person)
    }
  }

  // Known people anywhere in the text, as whole words.
  for (const [name, person] of lookup) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (new RegExp(`[\\s,(]${escaped}(?:['’]s)?[\\s,.)!?]`, "u").test(text)) {
      byName.set(person.id, { name: person.name, personId: person.id })
    }
  }
  for (const name of namesAfterCues(description)) {
    const person = lookup.get(name)
    const key = person?.id ?? name
    if (!byName.has(key)) {
      byName.set(
        key,
        person
          ? { name: person.name, personId: person.id }
          : { name: display(name), personId: null }
      )
    }
  }
  // In the order they appear, so "mara and ben" reads back the same way.
  const at = (c: NameCandidate) => {
    const names = [
      c.name,
      ...(known.find((k) => k.id === c.personId)?.aliases ?? []),
    ]
    const hits = names
      .map((n) => text.indexOf(n.toLowerCase()))
      .filter((i) => i >= 0)
    return hits.length ? Math.min(...hits) : Infinity
  }
  return [...byName.values()]
    .toSorted((a, b) => at(a) - at(b))
    .slice(0, MAX_CANDIDATES)
}
