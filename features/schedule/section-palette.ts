// Section palette: five shadcn chart tokens. A color is assigned at
// section creation by the Go service (count % 5 + 1) and persisted on
// the row — deleting a section in the middle never reshuffles siblings.
// The frontend just maps the stored key to a class name; the index-based
// fallback only kicks in for rows that pre-date the auto-assign.

export type SectionColor =
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"

const ORDER: SectionColor[] = [
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
]

// Full class names — Tailwind's JIT scanner needs them as literals.
const BORDER_CLASS: Record<SectionColor, string> = {
  "chart-1": "border-chart-1",
  "chart-2": "border-chart-2",
  "chart-3": "border-chart-3",
  "chart-4": "border-chart-4",
  "chart-5": "border-chart-5",
}

const SWATCH_CLASS: Record<SectionColor, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
}

export const PALETTE_COLORS: SectionColor[] = ORDER

function isSectionColor(s: string | undefined | null): s is SectionColor {
  return (
    s === "chart-1" ||
    s === "chart-2" ||
    s === "chart-3" ||
    s === "chart-4" ||
    s === "chart-5"
  )
}

// Resolves the color for a section: prefer the persisted value, fall
// back to position-based for legacy rows that haven't been backfilled.
export function resolveSectionColor(
  stored: string | undefined | null,
  fallbackIndex: number
): SectionColor {
  if (isSectionColor(stored)) return stored
  return ORDER[fallbackIndex % ORDER.length]
}

export function sectionBorderClass(color: SectionColor): string {
  return BORDER_CLASS[color]
}

export function sectionSwatchClass(color: SectionColor): string {
  return SWATCH_CLASS[color]
}
