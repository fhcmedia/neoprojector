// Predefined song section types and their visual identity. The `key` is the
// canonical string persisted in song_section.type. Colors are reused
// elsewhere — section chip background, future presentation labels, etc.
//
// Chips use the chart palette (shadcn tokens) so they theme cleanly.

export type SongSectionType = {
  key: string
  label: string
  chip: string // chip background in the editor (muted)
  swatch: string // solid color for menus/legends
  text: string // chip text color
}

export const songSectionTypes: SongSectionType[] = [
  {
    key: "verse",
    label: "Verse",
    chip: "bg-chart-1/30",
    swatch: "bg-chart-1",
    text: "text-foreground",
  },
  {
    key: "chorus",
    label: "Chorus",
    chip: "bg-chart-2/30",
    swatch: "bg-chart-2",
    text: "text-foreground",
  },
  {
    key: "pre_chorus",
    label: "Pre-Chorus",
    chip: "bg-chart-3/30",
    swatch: "bg-chart-3",
    text: "text-foreground",
  },
  {
    key: "bridge",
    label: "Bridge",
    chip: "bg-chart-4/30",
    swatch: "bg-chart-4",
    text: "text-foreground",
  },
  {
    key: "tag",
    label: "Tag",
    chip: "bg-chart-5/30",
    swatch: "bg-chart-5",
    text: "text-foreground",
  },
]

const byKey: Record<string, SongSectionType> = Object.fromEntries(
  songSectionTypes.map((t) => [t.key, t])
)

export function songSectionType(key: string | undefined): SongSectionType {
  if (!key) return songSectionTypes[0]
  return byKey[key] ?? songSectionTypes[0]
}
