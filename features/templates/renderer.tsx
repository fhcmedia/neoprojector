import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  parseTemplateBody,
  type Background,
  type Box,
  type RichText,
  type SlotFill,
  type SlotValue,
  type Span,
  type TemplateBody,
} from "@/features/templates/types"

// ─────────────────────────────────────────────────────────────────────────────
// Public API
//
// <TemplateCanvas/> renders a template at its native viewport size
// (e.g. 1920×1080). The caller wraps it in a scaling container to fit
// whatever real space is available — thumbnail, editor canvas, output.
//
// Scale-to-fit utilities live below as helper hooks/components so a
// thumbnail in the Templates grid is one line away.
// ─────────────────────────────────────────────────────────────────────────────

export type RawTemplate = {
  id: number
  name: string
  kind: string
  viewport_w: number
  viewport_h: number
  data_json: string
}

type CanvasProps = {
  template: RawTemplate
  fill?: SlotFill
  /**
   * When true, fit-to-box DOM measurement runs after layout. Set false
   * for thumbnails where text is unreadable anyway — saves a render
   * pass per box. Default true.
   */
  measure?: boolean
  /**
   * Editor hooks. When `onSelectBox` is provided, each box becomes
   * clickable and the box matching `selectedBoxIndex` shows a selection
   * ring. Thumbnails leave both undefined for a pure render.
   *
   * `body` lets callers pass an already-parsed body (e.g. the editor's
   * working copy held in state). When omitted we parse from
   * template.data_json so consumers without local edits can keep
   * passing a Template row straight through.
   *
   * `scale` is the screen-px-per-native-px ratio of the surrounding
   * wrapper. When provided we use it to keep the transparent-checker
   * tiles at a constant screen size regardless of zoom — so a tile
   * thumbnail and a full-screen editor view both show the same
   * recognisable checker grid, never the muddy-grey "zoomed out" look.
   */
  selectedBoxIndex?: number
  onSelectBox?: (index: number) => void
  body?: TemplateBody
  scale?: number
  /**
   * When true, a transparent background renders as actual
   * transparency (lets whatever is underneath show through) instead
   * of the editor's checkerboard visualization. Set this on the
   * live output route so the audience doesn't see the checker.
   * Defaults to false so editor/library/preview keep the checker.
   */
  liveTransparency?: boolean
}

export function TemplateCanvas({
  template,
  fill = {},
  measure = true,
  selectedBoxIndex,
  onSelectBox,
  body: bodyOverride,
  scale = 1,
  liveTransparency = false,
}: CanvasProps) {
  const body = bodyOverride ?? parseTemplateBody(template.data_json)
  const interactive = !!onSelectBox

  function handleCanvasMouseDown(e: React.MouseEvent) {
    // Clicking the canvas background (not a box) clears selection.
    if (!interactive) return
    if (e.target !== e.currentTarget) return
    onSelectBox?.(-1)
  }

  return (
    <div
      onMouseDown={handleCanvasMouseDown}
      style={{
        position: "relative",
        width: template.viewport_w,
        height: template.viewport_h,
        overflow: "hidden",
      }}
    >
      <BackgroundLayer
        background={body.background}
        fill={fill}
        scale={scale}
        liveTransparency={liveTransparency}
      />
      {body.boxes.map((box, i) => (
        <BoxRenderer
          key={i}
          box={box}
          value={resolveSlot(box, fill)}
          measure={measure}
          selected={selectedBoxIndex === i}
          interactive={interactive}
          onSelect={interactive ? () => onSelectBox?.(i) : undefined}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Scaling wrapper — fits a TemplateCanvas inside `containerW × containerH`
// while preserving aspect ratio. Used by thumbnails and full-screen
// previews alike.
// ─────────────────────────────────────────────────────────────────────────────

export function ScaledTemplate({
  template,
  fill,
  measure,
  selectedBoxIndex,
  onSelectBox,
  body,
  className,
  style,
  liveTransparency,
}: CanvasProps & { className?: string; style?: React.CSSProperties }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      const s = Math.min(
        width / template.viewport_w,
        height / template.viewport_h
      )
      setScale(s)
    }
    update() // synchronous before first paint
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [template.viewport_w, template.viewport_h])

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: template.viewport_w,
          height: template.viewport_h,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <TemplateCanvas
          template={template}
          fill={fill}
          measure={measure}
          selectedBoxIndex={selectedBoxIndex}
          onSelectBox={onSelectBox}
          body={body}
          scale={scale}
          liveTransparency={liveTransparency}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Background
// ─────────────────────────────────────────────────────────────────────────────

function BackgroundLayer({
  background,
  fill,
  scale,
  liveTransparency,
}: {
  background: Background
  fill: SlotFill
  scale: number
  liveTransparency?: boolean
}) {
  // Slot-bound media for the `media` slot wins over the template's
  // declared background, when present and the template doesn't already
  // include media content of its own.
  const slotMedia = fill.media
  if (slotMedia) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#222",
          color: "#888",
          display: "grid",
          placeItems: "center",
          fontSize: 24,
          fontFamily: "monospace",
        }}
      >
        media #{slotMedia.mediaId}
      </div>
    )
  }

  if (background.type === "color") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: background.value,
        }}
      />
    )
  }
  if (background.type === "media") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "color-mix(in oklch, var(--foreground) 6%, var(--background))",
          color: "var(--muted-foreground)",
          display: "grid",
          placeItems: "center",
          fontSize: 24,
          fontFamily: "monospace",
        }}
      >
        media #{background.mediaId}
      </div>
    )
  }
  // Transparent on the live output: actually transparent — let the
  // output window's black canvas (or whatever sits underneath in the
  // editor preview chain) show through. The checker is an editor
  // affordance only; the audience should never see it.
  if (liveTransparency) {
    return null
  }
  // Transparent in the editor / library / previews: subtle theme-
  // aware checker pattern. The pattern size (one full repeat — two
  // visual tiles in each axis) is picked so two constraints hold
  // simultaneously:
  //   (1) the pattern lands close to ~28px on screen at any zoom
  //       (gives a visible ~14px-per-tile checker — never the muddy
  //       grey of an over-shrunken pattern).
  //   (2) the chosen native pattern size divides both viewport_w and
  //       viewport_h evenly, so no partial half-tiles overflow the
  //       canvas edges. We snap to the nearest divisor of
  //       gcd(viewport_w, viewport_h).
  const TARGET_PATTERN_SCREEN = 28
  const patternSize = pickCleanPatternSize(TARGET_PATTERN_SCREEN, scale)
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "var(--background)",
        backgroundImage:
          "repeating-conic-gradient(" +
          "color-mix(in oklch, var(--foreground) 7%, transparent) 0% 25%, " +
          "transparent 0% 50%)",
        backgroundSize: `${patternSize}px ${patternSize}px`,
      }}
    />
  )
}

function pickCleanPatternSize(targetScreen: number, scale: number): number {
  // Divisors of gcd(1920, 1080) = 120, so every candidate produces
  // an integer count of pattern cells in both axes — clean tiling on
  // every edge of the canvas regardless of zoom. We pick the
  // candidate whose post-scale screen size sits closest to the
  // target, so visual density stays roughly constant.
  const CLEAN: readonly number[] = [
    8, 10, 12, 15, 20, 24, 30, 40, 60, 120,
  ]
  if (scale <= 0) return 60
  const ideal = targetScreen / scale
  let best = CLEAN[0]
  let bestDist = Math.abs(CLEAN[0] - ideal)
  for (const c of CLEAN) {
    const d = Math.abs(c - ideal)
    if (d < bestDist) {
      best = c
      bestDist = d
    }
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────────────
// Box renderer + fit-to-box
//
// Strategy: render at the box's declared fontSize, then if `fitToBox`
// is true and the rendered content overflows the box, shrink by 4px
// increments down toward fontSizeMin until it fits or the floor is hit.
// Bounded loop, so a runaway content can't lock the UI.
// ─────────────────────────────────────────────────────────────────────────────

function BoxRenderer({
  box,
  value,
  measure,
  selected,
  interactive,
  onSelect,
}: {
  box: Box
  value: SlotValue | undefined
  measure: boolean
  selected?: boolean
  interactive?: boolean
  onSelect?: () => void
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(box.fontSize)

  // Reset on box change or value change.
  useEffect(() => setFontSize(box.fontSize), [box.fontSize, value])

  useLayoutEffect(() => {
    if (!box.fitToBox || !measure) return
    const el = innerRef.current
    if (!el) return
    let current = box.fontSize
    // Iteratively shrink. 4px steps strike a balance between fewer
    // reflows and not visibly missing a fit-at-N-1 case.
    while (
      current > box.fontSizeMin &&
      (el.scrollHeight > el.clientHeight ||
        el.scrollWidth > el.clientWidth)
    ) {
      current -= 4
      el.style.fontSize = `${current}px`
    }
    if (current !== fontSize) setFontSize(current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.fitToBox, box.fontSize, box.fontSizeMin, value, measure])

  const justifyContent =
    box.vAlign === "top"
      ? "flex-start"
      : box.vAlign === "bottom"
        ? "flex-end"
        : "center"

  const isInteractive = interactive ?? !!onSelect

  return (
    <div
      onMouseDown={
        isInteractive
          ? (e) => {
              e.stopPropagation()
              onSelect?.()
            }
          : undefined
      }
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        display: "flex",
        flexDirection: "column",
        justifyContent,
        overflow: "hidden",
        textAlign: box.align,
        cursor: isInteractive ? "pointer" : undefined,
        opacity: box.opacity,
        backgroundColor: box.bgColor,
        padding:
          box.paddingX || box.paddingY
            ? `${box.paddingY ?? 0}px ${box.paddingX ?? 0}px`
            : undefined,
        // Selection ring sits inside the box bounds via outline so it
        // doesn't shift layout. Sky-blue at full width (3px) reads
        // cleanly on dark and transparent backgrounds.
        outline: selected ? "3px solid rgb(56, 189, 248)" : undefined,
        outlineOffset: selected ? "-3px" : undefined,
      }}
    >
      {value !== undefined && value !== null ? (
        <div
          ref={innerRef}
          style={{
            fontFamily: box.font,
            fontSize,
            fontWeight: box.weight,
            fontStyle: box.italic ? "italic" : "normal",
            color: box.color,
            lineHeight: box.lineHeight,
            textAlign: box.align,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            letterSpacing: box.letterSpacing ? `${box.letterSpacing}em` : undefined,
            textTransform: box.uppercase ? "uppercase" : undefined,
            textDecoration: box.underline ? "underline" : undefined,
            textShadow: box.shadow
              ? "0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.7)"
              : undefined,
          }}
        >
          {renderSlotValue(value)}
        </div>
      ) : isInteractive ? (
        // Editor affordance: empty boxes still show a faint slot
        // hint so the user can click into them.
        <div
          style={{
            margin: "auto",
            fontFamily: "Inter",
            fontSize: 22,
            color: "rgba(255,255,255,0.35)",
            fontStyle: "italic",
          }}
        >
          {box.slot}
        </div>
      ) : null}
    </div>
  )
}

function renderSlotValue(value: SlotValue): React.ReactNode {
  if (typeof value === "string") return value
  return value.map((span, i) => <SpanNode key={i} span={span} />)
}

function SpanNode({ span }: { span: Span }) {
  return (
    <span
      style={{
        fontWeight: span.bold ? 700 : undefined,
        fontStyle: span.italic ? "italic" : undefined,
        textDecoration:
          span.underline && span.strike
            ? "underline line-through"
            : span.underline
              ? "underline"
              : span.strike
                ? "line-through"
                : undefined,
        color: span.color,
        fontSize: span.sizeMul ? `${span.sizeMul}em` : undefined,
      }}
    >
      {span.text}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot resolution: live fill > box.defaultContent > undefined
// ─────────────────────────────────────────────────────────────────────────────

function resolveSlot(box: Box, fill: SlotFill): SlotValue | undefined {
  const fromFill = fill[box.slot]
  if (fromFill !== undefined && !isMediaSlot(box.slot)) {
    return fromFill as SlotValue
  }
  if (box.defaultContent !== undefined && !isMediaSlot(box.slot)) {
    return box.defaultContent as SlotValue
  }
  return undefined
}

function isMediaSlot(slot: Box["slot"]): boolean {
  return slot === "media"
}

// Re-export for callers that want to roll their own canvas wrapper.
export type { TemplateBody, SlotFill }
