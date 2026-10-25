// Overlay shape: one widget instance (countdown, clock, …) with a
// default visual layout plus optional per-display overrides. The Go
// side stores config_json and layouts_json as opaque blobs — this
// module is the single source of truth for what's inside them.
//
// Adding a new WidgetKind is a one-file change: append the literal
// here, then register a renderer + editor in widgets.tsx.

export type WidgetKind =
  | "countdown"
  | "clock"
  | "sermon_timer"
  | "preacher_name"
  | "message"
  | "qr"

// OverlayLayout: where and how the widget renders on a given display.
// Coordinates and sizes are 0..1 normalized so the same overlay
// scales cleanly across displays of different resolutions. Style is
// kind-specific (font, color, etc.); the registry's renderer is the
// only thing that interprets it.
export type OverlayLayout = {
  x: number
  y: number
  w: number
  h: number
  style: Record<string, unknown>
}

// OverlayLayouts: "default" is the fallback used by any display that
// doesn't have its own override. `displays` maps display.id (as a
// stringified number — JSON object keys are strings) to an override.
export type OverlayLayouts = {
  default: OverlayLayout
  displays: Record<string, OverlayLayout>
}

// OverlayRules: behavior flags that aren't visual or widget-content.
// Cross-cutting toggles live here so widget configs stay focused on
// their own data.
export type OverlayRules = {
  // When true, the output route hides the bound slide template
  // while this overlay is active. Useful for countdowns/welcome
  // screens where the overlay IS the presentation.
  cover_slide?: boolean
  // Sticky overlays are pinned: they render above every other layer
  // (slide text, presentations) and Esc's "clear overlays" skips them,
  // so they survive the operator jumping between bible references.
  // Only toggling the schedule item (or "Clear all overlays") ends them.
  sticky?: boolean
  // Displays (by id) this overlay renders on. Absent = every display,
  // including ones added later; an empty list = none.
  display_ids?: number[]
}

export const DEFAULT_RULES: OverlayRules = { cover_slide: false }

// overlayShownOn reports whether an overlay with these rules renders
// on the given display.
export function overlayShownOn(rules: OverlayRules, displayId: number): boolean {
  return !rules.display_ids || rules.display_ids.includes(displayId)
}

// parseRules reads rules_json, falling back to `fallback` for any
// field the JSON doesn't set. Pass the widget kind's defaultRules so
// rows created before a rule was introduced (or rows with an empty
// rules_json blob) still get the right kind-specific behaviour. An
// explicit `false` in the JSON overrides the fallback — the operator
// can always turn a default off.
export function parseRules(
  json: string,
  fallback: OverlayRules = DEFAULT_RULES
): OverlayRules {
  if (!json) return { ...fallback }
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === "object"
      ? { ...fallback, ...parsed }
      : { ...fallback }
  } catch {
    return { ...fallback }
  }
}

export function parseConfig<T extends Record<string, unknown>>(
  json: string,
  fallback: T
): T {
  if (!json) return fallback
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === "object"
      ? ({ ...fallback, ...parsed } as T)
      : fallback
  } catch {
    return fallback
  }
}

export function parseLayouts(
  json: string,
  fallbackDefault: OverlayLayout
): OverlayLayouts {
  const empty: OverlayLayouts = { default: fallbackDefault, displays: {} }
  if (!json) return empty
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== "object") return empty
    return {
      default: { ...fallbackDefault, ...(parsed.default ?? {}) },
      displays:
        parsed.displays && typeof parsed.displays === "object"
          ? (parsed.displays as Record<string, OverlayLayout>)
          : {},
    }
  } catch {
    return empty
  }
}

// resolveLayout returns the layout to use for a given display id,
// preferring the per-display override and falling back to the
// overlay's default.
export function resolveLayout(
  layouts: OverlayLayouts,
  displayId: number
): OverlayLayout {
  return layouts.displays[String(displayId)] ?? layouts.default
}
