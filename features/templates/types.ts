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
  // crossSlideUniform: aggregate the fit-to-box minimum ACROSS every
  // slide in the active item and apply that single value to every
  // fitToBox box on every slide. Used by lower-thirds templates where
  // a stable, consistent font across verses is the whole point. Off
  // for audience templates: each slide independently shrinks to fit
  // its own content. Within a slide, fitToBox boxes always coordinate
  // to share one fontSize regardless of this flag — the flag only
  // controls whether different slides talk to each other.
  // Defaults to false; existing templates without the field behave
  // as "per-slide only", which matches user-visible behavior in
  // every non-lower-thirds default.
  crossSlideUniform?: boolean
  /**
   * Per-template raw CSS. Injected into a <style> block scoped to this
   * template's root via CSS nesting — selectors the user writes only
   * touch elements rendered by THIS template, not the rest of the app.
   * Boxes get `data-slot` and `data-box-index` attributes, plus an
   * optional per-box className, so users can target them precisely
   * (e.g. `[data-slot="primary"] { animation: ...; }`).
   * Empty/undefined = no extra styles.
   */
  customCSS?: string
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
  | { type: "gradflow"; config: GradflowConfig }

export type GradflowType =
  | "linear"
  | "animated"
  | "conic"
  | "wave"
  | "silk"
  | "smoke"
  | "stripe"

export type GradflowConfig = {
  color1: { r: number; g: number; b: number }
  color2: { r: number; g: number; b: number }
  color3: { r: number; g: number; b: number }
  speed: number
  scale: number
  // Renamed from gradflow's own `type` field so it doesn't collide
  // with the outer Background discriminator. Mapped back at render.
  gradientType: GradflowType
  noise: number
  /** CSS filter: blur(Npx) applied to the gradient surface only. 0 = off. */
  blur?: number
}

export const DEFAULT_GRADFLOW: GradflowConfig = {
  color1: { r: 163, g: 106, b: 242 },
  color2: { r: 0, g: 0, b: 0 },
  color3: { r: 234, g: 130, b: 106 },
  speed: 0.6,
  scale: 1.2,
  gradientType: "silk",
  noise: 0.18,
}

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
  /** Optional CSS class for use with template.customCSS targeting. */
  className?: string
  /** Backdrop blur in px applied behind the box — legibility booster
   *  for text sitting on busy backgrounds (animated gradients, video,
   *  images). 0 = off. */
  backdropBlur?: number
  /** Multiplier on backdrop brightness (1 = unchanged, 0.5 = darken).
   *  Combined with bgColor for a frosted-glass look. */
  backdropBrightness?: number
  /** Multiplier on backdrop saturation (1 = unchanged). */
  backdropSaturate?: number
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
  // Visual framing. `loop` is legacy from before playback fields
  // existed — kept for backwards compatibility with stored data;
  // new code should rely on `playing`/`loop` (the boolean below)
  // for behavior and use `mode` only for `cover` vs `contain`.
  mode?: "cover" | "contain" | "loop"
  // Operator-driven playback state for video/audio. Ignored for
  // images (they don't have a play head). `playing=false` pauses
  // at the current frame on the output; `restartToken` is bumped
  // by the operator to force a seek-to-0+play, which is how the
  // "Restart" control communicates intent without needing a
  // position field.
  playing?: boolean
  loop?: boolean
  muted?: boolean
  restartToken?: number
}

// Default an empty body so a corrupt or missing data_json still renders
// (as a blank canvas) rather than throwing.
export const EMPTY_BODY: TemplateBody = {
  background: { type: "color", value: "#000000" },
  boxes: [],
  transition: { kind: "fade", duration_ms: 500 },
}

// Default transition used when a template's body parses without one
// (older templates that pre-date this field). 500ms is comfortable for
// the audience — fast enough to feel responsive when the operator
// advances a slide, slow enough that the crossfade reads as deliberate
// motion rather than a flicker.
export const DEFAULT_TRANSITION: TemplateTransition = {
  kind: "fade",
  duration_ms: 500,
}

export function parseTemplateBody(json: string): TemplateBody {
  try {
    const parsed = JSON.parse(json) as Partial<TemplateBody>
    return {
      background: parsed.background ?? EMPTY_BODY.background,
      boxes: Array.isArray(parsed.boxes) ? parsed.boxes : [],
      transition: parsed.transition ?? DEFAULT_TRANSITION,
      crossSlideUniform: parsed.crossSlideUniform === true,
      customCSS:
        typeof parsed.customCSS === "string" ? parsed.customCSS : undefined,
    }
  } catch {
    return EMPTY_BODY
  }
}
