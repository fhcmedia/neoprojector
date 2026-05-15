// Shape of the JSON body stored in template.data_json. Parsed lazily by
// the renderer — never inspected by SQL. Kept in TypeScript only; the
// Go side carries the raw string and treats it as opaque.

export type TemplateBody = {
  background: Background
  boxes: Box[]
}

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
}

export function parseTemplateBody(json: string): TemplateBody {
  try {
    const parsed = JSON.parse(json) as Partial<TemplateBody>
    return {
      background: parsed.background ?? EMPTY_BODY.background,
      boxes: Array.isArray(parsed.boxes) ? parsed.boxes : [],
    }
  } catch {
    return EMPTY_BODY
  }
}
