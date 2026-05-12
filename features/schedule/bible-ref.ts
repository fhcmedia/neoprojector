import type { BibleBook } from "@/bindings/neoprojector/database"

export type ParsedRef = {
  book: string // canonical DB name
  chapter?: number
  verseStart?: number
  verseEnd?: number
}

// normalize converts a book text to a comparable form:
// lowercase, leading digits become roman ("1 " -> "i", "2 " -> "ii", "3 " -> "iii"),
// then strips spaces and dots so "1 Cor" == "i cor." == "icor".
function normalize(s: string): string {
  let out = s.toLowerCase().trim()
  out = out.replace(/^([123])\s*/, (_, d: string) => {
    return ["i", "ii", "iii"][Number(d) - 1]
  })
  return out.replace(/[\s.]/g, "")
}

// lookupBook resolves a user-typed book fragment to its canonical DB name,
// or null if ambiguous/unknown. Requires at least 2 chars of prefix.
function lookupBook(input: string, books: BibleBook[]): string | null {
  const key = normalize(input)
  if (!key) return null

  const candidates = new Set<string>()
  for (const b of books) {
    for (const form of [b.name, b.name_kjv]) {
      const nk = normalize(form)
      if (nk === key) return b.name // exact wins immediately
      if (key.length >= 2 && nk.startsWith(key)) candidates.add(b.name)
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null
}

// parseBibleRef parses a free-form reference. Returns the most specific
// result it can resolve from the input:
//   "Gen"            → { book: "Genesis" }
//   "Gen 2"          → { book, chapter }
//   "Gen 2:5"        → { book, chapter, verseStart }
//   "Gen 2:5-8"      → { book, chapter, verseStart, verseEnd }
// Returns null if the book can't be resolved unambiguously.
export function parseBibleRef(
  input: string,
  books: BibleBook[]
): ParsedRef | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Full form: book chapter[:verse[-verse]]
  const full = trimmed.match(
    /^(.+?)\s+(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/
  )
  if (full) {
    const [, bookText, chapterStr, vStartStr, vEndStr] = full
    const book = lookupBook(bookText, books)
    if (book) {
      const chapter = Number(chapterStr)
      const verseStart = vStartStr ? Number(vStartStr) : undefined
      let verseEnd = vEndStr ? Number(vEndStr) : verseStart
      if (verseStart && verseEnd && verseEnd < verseStart) verseEnd = verseStart
      return { book, chapter, verseStart, verseEnd }
    }
  }

  // Book-only fallback: keep panes responsive while the user is still typing.
  const bookOnly = lookupBook(trimmed, books)
  if (bookOnly) return { book: bookOnly }

  return null
}
