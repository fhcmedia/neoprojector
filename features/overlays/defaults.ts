import type { Overlay } from "@/bindings/neoprojector/database"
import { widgetDef } from "@/features/overlays/widgets"
import type { OverlayLayouts, WidgetKind } from "@/features/overlays/types"

// Default overlays live in the frontend (mirroring template defaults).
// Negative ids are the marker. Defaults are directly editable: the
// first edit persists a shadow row in the DB reusing the seed's
// negative id, and the library merge resolves that row over the seed.
// Restore (library tile / settings) deletes the shadow.

export function isDefaultOverlayId(id: number): boolean {
  return id < 0
}

function buildDefault(
  id: number,
  name: string,
  kind: WidgetKind,
  configPatch: Record<string, unknown> = {}
): Overlay {
  const def = widgetDef(kind)
  const layouts: OverlayLayouts = {
    default: def.defaultLayout,
    displays: {},
  }
  return {
    id,
    name,
    kind,
    config_json: JSON.stringify({ ...def.defaultConfig, ...configPatch }),
    layouts_json: JSON.stringify(layouts),
    rules_json: JSON.stringify(def.defaultRules),
    position: id, // negative → sorts before any user overlay
    created_at: "",
    updated_at: "",
  } as Overlay
}

// One default per widget kind. Order here is the order they appear
// in the library; keep the most commonly-used ones first.
export const DEFAULT_OVERLAYS: Overlay[] = [
  buildDefault(-1, "Countdown", "countdown"),
  buildDefault(-2, "Clock", "clock"),
  buildDefault(-3, "Sermon timer", "sermon_timer"),
  buildDefault(-4, "Name card", "preacher_name"),
  buildDefault(-5, "Message", "message"),
  buildDefault(-6, "QR code", "qr"),
]
