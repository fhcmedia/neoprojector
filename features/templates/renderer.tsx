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
  is_default: number
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
}

export function TemplateCanvas({
  template,
  fill = {},
  measure = true,
}: CanvasProps) {
  const body = parseTemplateBody(template.data_json)
  return (
    <div
      // Native-resolution canvas. Positioning of boxes is relative to
      // these dimensions; the consumer scales the whole thing.
      style={{
        position: "relative",
        width: template.viewport_w,
        height: template.viewport_h,
        overflow: "hidden",
      }}
    >
      <BackgroundLayer background={body.background} fill={fill} />
      {body.boxes.map((box, i) => (
        <BoxRenderer
          key={i}
          box={box}
          value={resolveSlot(box, fill)}
          measure={measure}
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
  className,
  style,
}: CanvasProps & { className?: string; style?: React.CSSProperties }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      const s = Math.min(
        width / template.viewport_w,
        height / template.viewport_h
      )
      setScale(s)
    })
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
}: {
  background: Background
  fill: SlotFill
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
          background: "#222",
          color: "#888",
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
  // Transparent: leave a faint dashed border so the slot grid stays
  // legible against the editor's dark UI. Hidden in production output
  // by passing `production` (TODO when we wire outputs).
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage:
          "repeating-conic-gradient(#1f1f1f 0% 25%, #161616 0% 50%)",
        backgroundSize: "32px 32px",
        opacity: 0.6,
      }}
    />
  )
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
}: {
  box: Box
  value: SlotValue | undefined
  measure: boolean
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

  if (value === undefined || value === null) return null

  const justifyContent =
    box.vAlign === "top"
      ? "flex-start"
      : box.vAlign === "bottom"
        ? "flex-end"
        : "center"

  return (
    <div
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
      }}
    >
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
        }}
      >
        {renderSlotValue(value)}
      </div>
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
