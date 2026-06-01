// Canonical color per schedule item kind — one source of truth so the
// add-item list, the live-row highlight, and the library tab underline
// can never drift apart. Colors are the shadcn chart tokens (app.css):
// chart-1 blue · chart-2 green · chart-3 yellow · chart-4 purple · chart-5 red.
//
// Assignment: Song green, Bible yellow, Media red, Presentation purple,
// Overlay blue.
//
// Class names are full literals so Tailwind's JIT scanner keeps them.

export type ItemKind = "song" | "bible" | "media" | "presentation" | "overlay"

export type KindColor = {
  borderL: string // left-border accent (add list)
  text: string // text/icon color (live row)
  tint: string // faint background wash (live row)
  bar: string // solid fill (tab underline)
}

export const KIND_COLOR: Record<ItemKind, KindColor> = {
  song: {
    borderL: "border-l-chart-2",
    text: "text-chart-2",
    tint: "bg-chart-2/15",
    bar: "bg-chart-2",
  },
  bible: {
    borderL: "border-l-chart-3",
    text: "text-chart-3",
    tint: "bg-chart-3/15",
    bar: "bg-chart-3",
  },
  media: {
    borderL: "border-l-chart-5",
    text: "text-chart-5",
    tint: "bg-chart-5/15",
    bar: "bg-chart-5",
  },
  presentation: {
    borderL: "border-l-chart-4",
    text: "text-chart-4",
    tint: "bg-chart-4/15",
    bar: "bg-chart-4",
  },
  overlay: {
    borderL: "border-l-chart-1",
    text: "text-chart-1",
    tint: "bg-chart-1/15",
    bar: "bg-chart-1",
  },
}

export function kindColor(kind: string): KindColor | undefined {
  return (KIND_COLOR as Record<string, KindColor>)[kind]
}
