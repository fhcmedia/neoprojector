// Section color palette. Five accents pulled from shadcn's chart tokens
// (`--chart-1`..`--chart-5` in App.css) so the palette stays in sync with the
// rest of the theme and adapts between light and dark mode.
//
// Saturation is tuned for a restrained, flat shadcn-style look:
//   header at /35 — present but not loud, just enough to anchor the section,
//   items at  /12 — a hint of color so the section feels grouped,
//   hover/active at /22 — same value for both so toggling between them is calm.
//
// Default (no color) keeps neutral muted styling.

export type SectionColor = {
  key: string
  label: string
  header: string
  headerText: string
  item: string
  itemHover: string
  itemActive: string
  swatch: string
}

export const sectionColorList: SectionColor[] = [
  {
    key: "1",
    label: "Accent 1",
    header: "bg-chart-1/35",
    headerText: "text-foreground",
    item: "bg-chart-1/12",
    itemHover: "hover:bg-chart-1/22",
    itemActive: "bg-chart-1/22",
    swatch: "bg-chart-1",
  },
  {
    key: "2",
    label: "Accent 2",
    header: "bg-chart-2/35",
    headerText: "text-foreground",
    item: "bg-chart-2/12",
    itemHover: "hover:bg-chart-2/22",
    itemActive: "bg-chart-2/22",
    swatch: "bg-chart-2",
  },
  {
    key: "3",
    label: "Accent 3",
    header: "bg-chart-3/35",
    headerText: "text-foreground",
    item: "bg-chart-3/12",
    itemHover: "hover:bg-chart-3/22",
    itemActive: "bg-chart-3/22",
    swatch: "bg-chart-3",
  },
  {
    key: "4",
    label: "Accent 4",
    header: "bg-chart-4/35",
    headerText: "text-foreground",
    item: "bg-chart-4/12",
    itemHover: "hover:bg-chart-4/22",
    itemActive: "bg-chart-4/22",
    swatch: "bg-chart-4",
  },
  {
    key: "5",
    label: "Accent 5",
    header: "bg-chart-5/35",
    headerText: "text-foreground",
    item: "bg-chart-5/12",
    itemHover: "hover:bg-chart-5/22",
    itemActive: "bg-chart-5/22",
    swatch: "bg-chart-5",
  },
]

const byKey: Record<string, SectionColor> = Object.fromEntries(
  sectionColorList.map((c) => [c.key, c])
)

// Default (no color) — no resting background. Items revert to the neutral
// muted palette for hover and selection.
export const defaultSectionColor: SectionColor = {
  key: "",
  label: "None",
  header: "",
  headerText: "text-muted-foreground/80",
  item: "",
  itemHover: "hover:bg-muted",
  itemActive: "bg-muted",
  swatch: "bg-foreground/20",
}

export function sectionColor(key: string | undefined): SectionColor {
  if (!key) return defaultSectionColor
  return byKey[key] ?? defaultSectionColor
}
