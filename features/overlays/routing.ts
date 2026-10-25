import { widgetDef } from "@/features/overlays/widgets"
import {
  overlayShownOn,
  parseRules,
  type WidgetKind,
} from "@/features/overlays/types"

// Per-display overlay routing, shared by the output window and the
// operator's preview tile so both composite identically:
//
//   under      — normal overlays, z1 (above background, below text)
//   top        — sticky overlays, above everything (slide text and
//                presentations), so a pinned sermon timer stays
//                visible whatever goes live
//   coverSlide — some overlay on this display hides the slide text
//
// Overlays whose display_ids exclude this display are dropped, and so
// are hide_on_content overlays while `contentLive` (a verse/song, media
// item or presentation is actually showing on this display). The
// accessor adapts the two activation shapes (Go-side OverlayActivation
// and the operator's ActiveOverlay) to the same kind + rules pair.
export function routeOverlays<T>(
  overlays: T[],
  displayId: number,
  get: (o: T) => { kind: string; rulesJSON: string },
  opts: { contentLive?: boolean } = {}
): { under: T[]; top: T[]; coverSlide: boolean } {
  const under: T[] = []
  const top: T[] = []
  let coverSlide = false
  for (const o of overlays) {
    const { kind, rulesJSON } = get(o)
    const rules = parseRules(rulesJSON, widgetDef(kind as WidgetKind).defaultRules)
    if (!overlayShownOn(rules, displayId)) continue
    if (rules.hide_on_content && opts.contentLive) continue
    if (rules.cover_slide) coverSlide = true
    if (rules.sticky) top.push(o)
    else under.push(o)
  }
  return { under, top, coverSlide }
}
