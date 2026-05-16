// Shape of the JSON body stored in template.data_json. Parsed lazily by
// the renderer — never inspected by SQL. Kept in TypeScript only; the
// Go side carries the raw string and treats it as opaque.

export type TemplateBody = {
  background: Background
  boxes: Box[]
  // transition is the motion played when the live slide swaps from
  // one fill to another using this template. Stored here so the same
  // template behaves identically across every display it's bound to.
  // Falls back to fade if absent — keeps existing templates working
  // without a migration.
  transition?: TemplateTransition
}

export type TemplateTransition = {
  kind: TransitionKind
  // milliseconds. 0 = instant cut regardless of `kind`.
  duration_ms: number
}

export type TransitionKind =
  | "none"
  | "fade"
  | "slide-up"
  | "slide-down"
  | "slide-left"
  | "slide-right"
  | "scale"
  | "blur"

export type Background =
  | { type: "color"; value: string }
  | { type: "transparent" }
  | { type: "media"; mediaId: number; mode?: "cover" | "contain" | "loop" }

export type SlotName =
  | "primary"
  | "secondary"
  | "tertiary"
  | "caption"
  | "media"

export type Box = {
  slot: SlotName
  x: number
  y: number
  w: number
  h: number
  font: string
  fontSize: number
  fontSizeMin: number
  fitToBox: boolean
  color: string
  weight: number
  italic: boolean
  align: "left" | "center" | "right"
  vAlign: "top" | "middle" | "bottom"
  maxLines: number
  lineHeight: number
  /** Box-level opacity, 0–1. Default 1 (fully opaque). */
  opacity?: number
  /** Letter spacing in em. 0 = normal. */
  letterSpacing?: number
  /** text-transform: uppercase */
  uppercase?: boolean
  /** text-decoration: underline */
  underline?: boolean
  /** Adds a strong drop-shadow so text pops on any background. */
  shadow?: boolean
  /** Background fill for the box. CSS color string, default transparent. */
  bgColor?: string
  /** Horizontal inner padding in native viewport px. */
  paddingX?: number
  /** Vertical inner padding in native viewport px. */
  paddingY?: number
  /**
   * Slot-level fallback fill — used when the live content doesn't provide
   * a value for this slot. Lets a template ship with e.g. its own
   * animated-video background.
   */
  defaultContent?: SlotFill[keyof SlotFill]
}

// SlotFill is what an item kind's fill() function produces. Renderer
// merges template box defaults with this to decide what to render.
export type SlotFill = Partial<{
  primary: SlotValue
  secondary: SlotValue
  tertiary: SlotValue
  caption: SlotValue
  media: MediaRef
}>

export type SlotValue = string | RichText

export type RichText = Span[]

export type Span = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  // 1.0 = use box's fontSize as-is; 1.2 = 20% bigger; 0.7 = smaller.
  sizeMul?: number
}

export type MediaRef = {
  mediaId: number
  mode?: "cover" | "contain" | "loop"
}

// Default an empty body so a corrupt or missing data_json still renders
// (as a blank canvas) rather than throwing.
export const EMPTY_BODY: TemplateBody = {
  background: { type: "color", value: "#000000" },
  boxes: [],
  transition: { kind: "fade", duration_ms: 180 },
}

// Default transition used when a template's body parses without one
// (older templates that pre-date this field).
export const DEFAULT_TRANSITION: TemplateTransition = {
  kind: "fade",
  duration_ms: 180,
}

export function parseTemplateBody(json: string): TemplateBody {
  try {
    const parsed = JSON.parse(json) as Partial<TemplateBody>
    return {
      background: parsed.background ?? EMPTY_BODY.background,
      boxes: Array.isArray(parsed.boxes) ? parsed.boxes : [],
      transition: parsed.transition ?? DEFAULT_TRANSITION,
    }
  } catch {
    return EMPTY_BODY
  }
}
