// Predefined song section types and their visual identity. The `key` is
// the canonical string persisted in song_section.type. Coloration follows
// the same philosophy as the schedule: a single left-border accent, no
// fills. `swatch` stays as a solid color so menus/legends can still show
// a dot when picking a section type.

export type SongSectionType = {
  key: string
  label: string
  border: string // left-border accent class
  swatch: string // solid color for menus/legends
}

export const songSectionTypes: SongSectionType[] = [
  { key: "verse", label: "Verse", border: "border-l-chart-1", swatch: "bg-chart-1" },
  { key: "chorus", label: "Chorus", border: "border-l-chart-2", swatch: "bg-chart-2" },
  { key: "pre_chorus", label: "Pre-Chorus", border: "border-l-chart-3", swatch: "bg-chart-3" },
  { key: "bridge", label: "Bridge", border: "border-l-chart-4", swatch: "bg-chart-4" },
  { key: "tag", label: "Tag", border: "border-l-chart-5", swatch: "bg-chart-5" },
]

const byKey: Record<string, SongSectionType> = Object.fromEntries(
  songSectionTypes.map((t) => [t.key, t])
)

export function songSectionType(key: string | undefined): SongSectionType {
  if (!key) return songSectionTypes[0]
  return byKey[key] ?? songSectionTypes[0]
}
