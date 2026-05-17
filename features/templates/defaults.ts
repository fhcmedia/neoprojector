import type { Template } from "@/bindings/neoprojector/database"
import { TEMPLATE_DEFAULT_FONT } from "@/features/templates/fonts"
import type { TemplateTransition } from "@/features/templates/types"

// Frontend default reference templates. These never touch the DB — they
// ship with the app, are pure read-only references in the Templates
// library, and become editable user rows only via "Duplicate to edit"
// (which posts a fresh CreateTemplate to the backend with the default's
// body).
//
// Theme awareness: colors use CSS variables (--background / --foreground
// / --muted-foreground) so the same template renders white-bg/black-text
// in light mode and black-bg/white-text in dark mode automatically. The
// renderer passes these values straight to CSS, which resolves them in
// context. When a user duplicates a default and edits a color via the
// picker, they get a hex value that overrides the variable — exactly
// the right migration path from "themed default" to "specific custom".
//
// IDs are negative so they never collide with DB-allocated row IDs. The
// editor route checks id < 0 and reads from this list instead of
// hitting the API.

const FG = "var(--foreground)"
const FG_MUTED = "var(--muted-foreground)"
const BG = "var(--background)"

type DefaultBox = {
  slot: "primary" | "secondary" | "tertiary" | "caption" | "media"
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
}

type DefaultTemplate = {
  id: number
  name: string
  kind: string
  viewportW: number
  viewportH: number
  body: {
    background: { type: "color" | "transparent"; value?: string }
    boxes: DefaultBox[]
    transition: TemplateTransition
    // See TemplateBody.crossSlideUniform. Defaults to false in JSON
    // when omitted; lower-thirds opts in explicitly.
    crossSlideUniform?: boolean
  }
}

// All defaults ship with the same gentle fade so duplicates of a default
// carry it forward — relying on parseTemplateBody's fallback would mean
// the field is absent from data_json, and a save through the editor could
// drop fade by writing whatever the editor's current transition state is.
const DEFAULT_FADE: TemplateTransition = { kind: "fade", duration_ms: 500 }

function bgThemed() {
  return { type: "color" as const, value: BG }
}

function bgTransparent() {
  return { type: "transparent" as const }
}

function box(o: Partial<DefaultBox> & Pick<DefaultBox, "slot" | "x" | "y" | "w" | "h">): DefaultBox {
  return {
    font: TEMPLATE_DEFAULT_FONT,
    fontSize: 56,
    fontSizeMin: 56,
    fitToBox: false,
    color: FG,
    weight: 500,
    italic: false,
    align: "center",
    vAlign: "middle",
    maxLines: 6,
    lineHeight: 1.25,
    ...o,
  }
}

const VW = 1920
const VH = 1080

const DEFAULTS: DefaultTemplate[] = [
  {
    id: -1,
    name: "Bible - One Translation",
    kind: "bible",
    viewportW: VW,
    viewportH: VH,
    body: {
      background: bgThemed(),
      transition: DEFAULT_FADE,
      // Single translation: medium weight throughout. Caption is the
      // only intentionally-lighter element (muted color + reg weight).
      // fitToBox on so a too-long verse shrinks to fit its own slide,
      // crossSlideUniform off so other verses keep their declared
      // size — every slide auto-sizes independently.
      boxes: [
        box({
          slot: "primary",
          x: 120, y: 240, w: 1680, h: 560,
          fontSize: 76, fontSizeMin: 40, fitToBox: true,
          weight: 500, maxLines: 8, lineHeight: 1.3,
        }),
        box({
          slot: "caption",
          x: 120, y: 880, w: 1680, h: 80,
          fontSize: 36, fontSizeMin: 28,
          color: FG_MUTED, weight: 400,
          maxLines: 1, lineHeight: 1.0,
        }),
      ],
    },
  },
  {
    id: -2,
    name: "Bible - Two Translations",
    kind: "bible",
    viewportW: VW,
    viewportH: VH,
    body: {
      background: bgThemed(),
      transition: DEFAULT_FADE,
      // Two translations: identical weight + color across primary and
      // secondary so neither reads as "the real one" and the other as
      // a footnote. Visual parity matches the editorial intent.
      // fitToBox on, crossSlideUniform off: within a slide, primary
      // and secondary share one fontSize (shrunk together if either
      // overflows); across slides, each verse auto-sizes its own.
      boxes: [
        box({
          slot: "primary",
          x: 120, y: 140, w: 1680, h: 340,
          fontSize: 64, fontSizeMin: 36, fitToBox: true,
          weight: 500, maxLines: 6, lineHeight: 1.25,
        }),
        box({
          slot: "secondary",
          x: 120, y: 520, w: 1680, h: 340,
          fontSize: 64, fontSizeMin: 36, fitToBox: true,
          color: FG, weight: 500,
          maxLines: 6, lineHeight: 1.25,
        }),
        box({
          slot: "caption",
          x: 120, y: 900, w: 1680, h: 60,
          fontSize: 32, fontSizeMin: 26,
          color: FG_MUTED, weight: 400,
          maxLines: 1, lineHeight: 1.0,
        }),
      ],
    },
  },
  {
    id: -3,
    name: "Bible - Three Translations",
    kind: "bible",
    viewportW: VW,
    viewportH: VH,
    body: {
      background: bgThemed(),
      transition: DEFAULT_FADE,
      // Three translations: same parity rule as 2-translation — equal
      // weight, equal color across all three.
      // fitToBox on, crossSlideUniform off: all three boxes share
      // one fontSize within a slide; each slide auto-sizes its own.
      boxes: [
        box({
          slot: "primary",
          x: 120, y: 100, w: 1680, h: 240,
          fontSize: 50, fontSizeMin: 32, fitToBox: true,
          weight: 500, maxLines: 5, lineHeight: 1.2,
        }),
        box({
          slot: "secondary",
          x: 120, y: 360, w: 1680, h: 240,
          fontSize: 50, fontSizeMin: 32, fitToBox: true,
          color: FG, weight: 500,
          maxLines: 5, lineHeight: 1.2,
        }),
        box({
          slot: "tertiary",
          x: 120, y: 620, w: 1680, h: 240,
          fontSize: 50, fontSizeMin: 32, fitToBox: true,
          color: FG, weight: 500,
          maxLines: 5, lineHeight: 1.2,
        }),
        box({
          slot: "caption",
          x: 120, y: 900, w: 1680, h: 60,
          fontSize: 30, fontSizeMin: 24,
          color: FG_MUTED, weight: 400,
          maxLines: 1, lineHeight: 1.0,
        }),
      ],
    },
  },
  {
    id: -4,
    name: "Bible - Lower Thirds",
    kind: "bible",
    viewportW: VW,
    viewportH: VH,
    body: {
      background: bgTransparent(),
      transition: DEFAULT_FADE,
      // Cross-slide uniform fit: every verse renders at the SAME
      // fontSize across the whole multi-verse range. Lower thirds
      // sit over video and need rock-stable typography; a jumpy
      // font as the operator advances would distract.
      crossSlideUniform: true,
      boxes: [
        box({
          slot: "primary",
          x: 80, y: 800, w: 1760, h: 140,
          fontSize: 50, fontSizeMin: 34, fitToBox: true,
          weight: 500, align: "left",
          maxLines: 3, lineHeight: 1.2,
        }),
        box({
          slot: "caption",
          x: 80, y: 960, w: 1760, h: 40,
          fontSize: 26, fontSizeMin: 22,
          color: FG_MUTED, weight: 400,
          align: "left",
          maxLines: 1, lineHeight: 1.0,
        }),
      ],
    },
  },
  {
    id: -5,
    name: "Song - Audience",
    kind: "song",
    viewportW: VW,
    viewportH: VH,
    body: {
      background: bgThemed(),
      transition: DEFAULT_FADE,
      // One big centered block. Audience reads the current line and only
      // the current line — no next-line preview here (that's a Stage
      // template thing, where worship leaders need the cue).
      boxes: [
        box({
          slot: "primary",
          x: 120, y: 200, w: 1680, h: 680,
          fontSize: 84, fontSizeMin: 44, fitToBox: true,
          weight: 600, maxLines: 8, lineHeight: 1.3,
        }),
      ],
    },
  },
  {
    id: -6,
    name: "Song - Stage",
    kind: "song",
    viewportW: VW,
    viewportH: VH,
    body: {
      background: bgThemed(),
      transition: DEFAULT_FADE,
      boxes: [
        box({
          slot: "primary",
          x: 120, y: 280, w: 1680, h: 220,
          fontSize: 72, fontSizeMin: 44, fitToBox: true,
          weight: 600, maxLines: 2, lineHeight: 1.3,
        }),
        box({
          slot: "secondary",
          x: 120, y: 540, w: 1680, h: 220,
          fontSize: 72, fontSizeMin: 44, fitToBox: true,
          color: FG, weight: 500,
          maxLines: 2, lineHeight: 1.3,
        }),
      ],
    },
  },
  {
    id: -7,
    name: "Song - Lower Thirds",
    kind: "song",
    viewportW: VW,
    viewportH: VH,
    body: {
      background: bgTransparent(),
      transition: DEFAULT_FADE,
      boxes: [
        box({
          slot: "primary",
          x: 80, y: 820, w: 1760, h: 160,
          fontSize: 56, fontSizeMin: 36, fitToBox: true,
          weight: 500, maxLines: 2, lineHeight: 1.2,
        }),
      ],
    },
  },
]

// Adapt the defaults into the same shape as DB-backed Template rows so
// downstream code (useTemplates, the tile grid, the editor) can treat
// them uniformly.
export const defaultTemplates: Template[] = DEFAULTS.map((d) => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  viewport_w: d.viewportW,
  viewport_h: d.viewportH,
  data_json: JSON.stringify(d.body),
  created_at: "",
  updated_at: "",
}))

export function isDefaultTemplateId(id: number): boolean {
  return id < 0
}

export function findDefaultTemplate(id: number): Template | undefined {
  return defaultTemplates.find((t) => t.id === id)
}
