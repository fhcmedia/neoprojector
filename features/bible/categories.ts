// Stable left-border color per bible book category. Same chart-1..5
// vocabulary the schedule uses so every bible surface (library tab,
// schedule picker) reads as one app. Cycles intentionally — eight
// categories on a five-color palette repeats, which keeps OT and NT
// visually anchored on the same hues.

const CATEGORY_BORDER: Record<string, string> = {
  law: "border-l-chart-1",
  history: "border-l-chart-2",
  poetry: "border-l-chart-3",
  major_prophets: "border-l-chart-4",
  minor_prophets: "border-l-chart-5",
  gospels: "border-l-chart-1",
  letters: "border-l-chart-2",
  prophecy: "border-l-chart-3",
}

const FALLBACK = "border-l-transparent"

export function bibleCategoryBorderClass(category: string | undefined): string {
  if (!category) return FALLBACK
  return CATEGORY_BORDER[category] ?? FALLBACK
}

// Canonical reference formatter. Trailing space after a book-only match
// lets the user keep typing the chapter without manually adding it.
export function formatBibleRef(
  book: string,
  chapter?: number,
  verseStart?: number,
  verseEnd?: number
): string {
  if (!chapter) return `${book} `
  let s = `${book} ${chapter}`
  if (verseStart !== undefined) {
    s += `:${verseStart}`
    if (verseEnd !== undefined && verseEnd !== verseStart) s += `-${verseEnd}`
  }
  return s
}
