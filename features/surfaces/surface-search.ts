// Surfaces are inline views that take over Show-page panes instead of
// being routes — the app's one window stays the Show page and content
// overlays it. Driven by typed search params on "/" so the shell
// (route-less) and the page can both read them.
export const SURFACES = ["settings", "template", "overlay", "background"] as const
export type Surface = (typeof SURFACES)[number]

export function parseSurface(v: unknown): Surface | undefined {
  return SURFACES.includes(v as Surface) ? (v as Surface) : undefined
}
