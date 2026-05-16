import { useLayoutEffect, useRef, useState } from "react"
import { TemplateCanvas } from "@/features/templates/renderer"
import type { RawTemplate } from "@/features/templates/renderer"
import type { Box, SlotFill, TemplateBody } from "@/features/templates/types"

// EditorCanvas: scales-to-fit like ScaledTemplate but adds an
// interaction overlay layered on top of the pure renderer. The overlay
// handles selection, drag-to-move, edge/corner resize, and snap
// guides. Coordinates are kept in native viewport units; the scale
// factor is captured at mousedown so mouse-screen deltas can be
// converted back into native units cheaply.

const SNAP_THRESHOLD = 8 // native px

type Handle =
  | "tl"
  | "tr"
  | "bl"
  | "br"
  | "t"
  | "r"
  | "b"
  | "l"

type GuideLine =
  | { axis: "x"; value: number }
  | { axis: "y"; value: number }

type Props = {
  template: RawTemplate
  body: TemplateBody
  fill: SlotFill
  selectedIndex: number
  onSelectIndex: (i: number) => void
  onBoxChange?: (i: number, patch: Partial<Box>) => void
  readOnly?: boolean
}

export function EditorCanvas({
  template,
  body,
  fill,
  selectedIndex,
  onSelectIndex,
  onBoxChange,
  readOnly = false,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [guides, setGuides] = useState<GuideLine[]>([])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      setScale(
        Math.min(
          width / template.viewport_w,
          height / template.viewport_h
        )
      )
    }
    update() // synchronous before first paint
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [template.viewport_w, template.viewport_h])

  function clearGuides() {
    setGuides([])
  }

  function startDrag(e: React.PointerEvent, i: number) {
    if (readOnly || !onBoxChange) return
    const change = onBoxChange
    e.preventDefault()
    e.stopPropagation()
    onSelectIndex(i)

    const startBox = { ...body.boxes[i] }
    const startX = e.clientX
    const startY = e.clientY
    // Snapshot scale at mousedown — even if the container resizes
    // mid-drag (rare), we keep a stable conversion. The active drag
    // ends quickly.
    const liveScale = scale
    // Don't activate drag/snap until the cursor actually moves. Without
    // this, a plain click triggers a zero-delta move that still runs
    // the snap engine — which can flash a guide line if the box's
    // current position already aligns with another (very common).
    let armed = false

    function move(ev: PointerEvent) {
      if (!armed) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY)
        if (dist < 4) return
        armed = true
      }
      const dxNative = (ev.clientX - startX) / liveScale
      const dyNative = (ev.clientY - startY) / liveScale
      const proposed: Box = {
        ...startBox,
        x: Math.round(startBox.x + dxNative),
        y: Math.round(startBox.y + dyNative),
      }
      const { box: snapped, guides: snapGuides } = applySnaps(
        proposed,
        body.boxes,
        i,
        template.viewport_w,
        template.viewport_h,
        "move"
      )
      setGuides(snapGuides)
      change(i, { x: snapped.x, y: snapped.y })
    }
    function up() {
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", up)
      clearGuides()
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
  }

  function startResize(
    e: React.PointerEvent,
    i: number,
    handle: Handle
  ) {
    if (readOnly || !onBoxChange) return
    const change = onBoxChange
    e.preventDefault()
    e.stopPropagation()
    onSelectIndex(i)

    const startBox = { ...body.boxes[i] }
    const startX = e.clientX
    const startY = e.clientY
    const liveScale = scale
    const minW = 40
    const minH = 30
    let armed = false

    function move(ev: PointerEvent) {
      if (!armed) {
        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY)
        if (dist < 4) return
        armed = true
      }
      const dx = (ev.clientX - startX) / liveScale
      const dy = (ev.clientY - startY) / liveScale

      let x = startBox.x
      let y = startBox.y
      let w = startBox.w
      let h = startBox.h

      // Each handle adjusts a different combination of edges. Anchors
      // (the opposite edges) stay fixed; the dragged edges move by the
      // delta. Min sizes prevent collapsing through zero.
      if (handle === "l" || handle === "tl" || handle === "bl") {
        const nx = Math.min(startBox.x + dx, startBox.x + startBox.w - minW)
        w = startBox.x + startBox.w - nx
        x = nx
      }
      if (handle === "r" || handle === "tr" || handle === "br") {
        w = Math.max(minW, startBox.w + dx)
      }
      if (handle === "t" || handle === "tl" || handle === "tr") {
        const ny = Math.min(startBox.y + dy, startBox.y + startBox.h - minH)
        h = startBox.y + startBox.h - ny
        y = ny
      }
      if (handle === "b" || handle === "bl" || handle === "br") {
        h = Math.max(minH, startBox.h + dy)
      }

      const proposed: Box = {
        ...startBox,
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      }
      const { box: snapped, guides: snapGuides } = applySnaps(
        proposed,
        body.boxes,
        i,
        template.viewport_w,
        template.viewport_h,
        "resize",
        handle
      )
      setGuides(snapGuides)
      change(i, {
        x: snapped.x,
        y: snapped.y,
        w: snapped.w,
        h: snapped.h,
      })
    }
    function up() {
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", up)
      clearGuides()
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
  }

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
      }}
      onPointerDown={(e) => {
        // Clicking the empty area clears selection.
        if (readOnly) return
        if (e.target === wrapRef.current) onSelectIndex(-1)
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
          body={body}
          fill={fill}
          measure
          scale={scale}
        />
        {/* Interaction layer at native coordinates. Hosts selection
           ring, drag region, resize handles, snap guides. Pointer
           events stay enabled in read-only so the user can still
           browse/select boxes for inspection — the drag and resize
           handlers themselves early-return on readOnly. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "auto",
          }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onSelectIndex(-1)
          }}
        >
          {body.boxes.map((box, i) => (
            <BoxInteract
              key={i}
              box={box}
              selected={selectedIndex === i}
              readOnly={readOnly}
              onSelect={() => onSelectIndex(i)}
              onPointerDown={(e) => startDrag(e, i)}
              onResizeStart={(e, h) => startResize(e, i, h)}
            />
          ))}
          <SnapGuidesLayer
            guides={guides}
            viewportW={template.viewport_w}
            viewportH={template.viewport_h}
          />
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Box interaction: invisible click target + selection ring + 8 handles.
// Sits on top of the rendered text in the canvas; events here win over
// the renderer's own clicks because the interaction layer is later in
// DOM order.
// ─────────────────────────────────────────────────────────────────────────────

function BoxInteract({
  box,
  selected,
  readOnly,
  onSelect,
  onPointerDown,
  onResizeStart,
}: {
  box: Box
  selected: boolean
  readOnly: boolean
  onSelect: () => void
  onPointerDown: (e: React.PointerEvent) => void
  onResizeStart: (e: React.PointerEvent, h: Handle) => void
}) {
  const [hovered, setHovered] = useState(false)
  // Outline policy: nothing by default (so the canvas is clean), a
  // faint dashed hint while hovered, and the solid sky-blue ring when
  // selected. Same affordance pattern as Slides/Figma.
  const outline = selected
    ? "3px solid var(--primary)"
    : hovered
      ? "1px dashed color-mix(in oklch, var(--foreground) 35%, transparent)"
      : undefined
  const outlineOffset = selected ? "-3px" : hovered ? "-1px" : undefined
  return (
    <div
      onPointerDown={(e) => {
        if (!readOnly) {
          onPointerDown(e)
        } else {
          onSelect()
        }
      }}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        cursor: readOnly ? "pointer" : "move",
        outline,
        outlineOffset,
        background: "transparent",
      }}
    >
      {selected && !readOnly && (
        <>
          <ResizeHandle h="tl" onPointerDown={(e) => onResizeStart(e, "tl")} />
          <ResizeHandle h="tr" onPointerDown={(e) => onResizeStart(e, "tr")} />
          <ResizeHandle h="bl" onPointerDown={(e) => onResizeStart(e, "bl")} />
          <ResizeHandle h="br" onPointerDown={(e) => onResizeStart(e, "br")} />
          <ResizeHandle h="t" onPointerDown={(e) => onResizeStart(e, "t")} />
          <ResizeHandle h="r" onPointerDown={(e) => onResizeStart(e, "r")} />
          <ResizeHandle h="b" onPointerDown={(e) => onResizeStart(e, "b")} />
          <ResizeHandle h="l" onPointerDown={(e) => onResizeStart(e, "l")} />
        </>
      )}
    </div>
  )
}

// 24px handle (native px). Renderer scales it down along with the
// canvas; at typical editor sizes that lands around 6–8 screen px,
// which is the same target zone Slides/Figma use.
const HANDLE_SIZE = 24

function ResizeHandle({
  h,
  onPointerDown,
}: {
  h: Handle
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const pos: React.CSSProperties = (() => {
    const half = HANDLE_SIZE / 2
    switch (h) {
      case "tl":
        return { top: -half, left: -half, cursor: "nwse-resize" }
      case "tr":
        return { top: -half, right: -half, cursor: "nesw-resize" }
      case "bl":
        return { bottom: -half, left: -half, cursor: "nesw-resize" }
      case "br":
        return { bottom: -half, right: -half, cursor: "nwse-resize" }
      case "t":
        return {
          top: -half,
          left: "50%",
          transform: "translateX(-50%)",
          cursor: "ns-resize",
        }
      case "b":
        return {
          bottom: -half,
          left: "50%",
          transform: "translateX(-50%)",
          cursor: "ns-resize",
        }
      case "l":
        return {
          left: -half,
          top: "50%",
          transform: "translateY(-50%)",
          cursor: "ew-resize",
        }
      case "r":
        return {
          right: -half,
          top: "50%",
          transform: "translateY(-50%)",
          cursor: "ew-resize",
        }
    }
  })()

  return (
    <span
      onPointerDown={(e) => {
        e.stopPropagation()
        onPointerDown(e)
      }}
      style={{
        position: "absolute",
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        background: "var(--primary)",
        border: "3px solid var(--primary-foreground)",
        borderRadius: 999,
        boxShadow:
          "0 0 0 1px color-mix(in oklch, var(--foreground) 35%, transparent)",
        ...pos,
      }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Snap engine
//
// During a drag/resize we collect candidate target lines from (a) the
// canvas's own center axes and edges, and (b) every other box's edges
// and centers. If a proposed box edge or center lands within
// SNAP_THRESHOLD of a target, the proposed coordinate is snapped and we
// emit a guide line for the renderer to draw.
// ─────────────────────────────────────────────────────────────────────────────

type Op = "move" | "resize"

function applySnaps(
  proposed: Box,
  boxes: Box[],
  selfIndex: number,
  vw: number,
  vh: number,
  op: Op,
  handle?: Handle
): { box: Box; guides: GuideLine[] } {
  const guides: GuideLine[] = []
  let { x, y, w, h } = proposed

  // Build target axis lists.
  const xTargets: number[] = [0, vw / 2, vw]
  const yTargets: number[] = [0, vh / 2, vh]
  boxes.forEach((b, i) => {
    if (i === selfIndex) return
    xTargets.push(b.x, b.x + b.w / 2, b.x + b.w)
    yTargets.push(b.y, b.y + b.h / 2, b.y + b.h)
  })

  // What edges/centers of the proposed box are we snapping?
  // For move: left, center, right (x) and top, middle, bottom (y) all participate.
  // For resize: only the moving edge(s).
  const xCandidates = computeXCandidates(proposed, op, handle)
  const yCandidates = computeYCandidates(proposed, op, handle)

  // Snap x
  let bestX: { delta: number; line: number } | null = null
  for (const target of xTargets) {
    for (const c of xCandidates) {
      const delta = target - c.value
      if (Math.abs(delta) <= SNAP_THRESHOLD) {
        if (!bestX || Math.abs(delta) < Math.abs(bestX.delta)) {
          bestX = { delta, line: target }
        }
      }
    }
  }
  if (bestX) {
    if (op === "move") {
      x += bestX.delta
    } else {
      // Resize: apply delta to the edge being dragged, keep opposite edge fixed.
      if (handle === "l" || handle === "tl" || handle === "bl") {
        const newX = x + bestX.delta
        w = w - (newX - x)
        x = newX
      }
      if (handle === "r" || handle === "tr" || handle === "br") {
        w = w + bestX.delta
      }
    }
    guides.push({ axis: "x", value: bestX.line })
  }

  // Snap y
  let bestY: { delta: number; line: number } | null = null
  for (const target of yTargets) {
    for (const c of yCandidates) {
      const delta = target - c.value
      if (Math.abs(delta) <= SNAP_THRESHOLD) {
        if (!bestY || Math.abs(delta) < Math.abs(bestY.delta)) {
          bestY = { delta, line: target }
        }
      }
    }
  }
  if (bestY) {
    if (op === "move") {
      y += bestY.delta
    } else {
      if (handle === "t" || handle === "tl" || handle === "tr") {
        const newY = y + bestY.delta
        h = h - (newY - y)
        y = newY
      }
      if (handle === "b" || handle === "bl" || handle === "br") {
        h = h + bestY.delta
      }
    }
    guides.push({ axis: "y", value: bestY.line })
  }

  return { box: { ...proposed, x, y, w, h }, guides }
}

type Candidate = { value: number }

function computeXCandidates(
  b: Box,
  op: Op,
  handle?: Handle
): Candidate[] {
  if (op === "move") {
    return [
      { value: b.x },
      { value: b.x + b.w / 2 },
      { value: b.x + b.w },
    ]
  }
  // Resize: only the dragged edge contributes to x-snapping.
  if (!handle) return []
  if (handle === "l" || handle === "tl" || handle === "bl") {
    return [{ value: b.x }]
  }
  if (handle === "r" || handle === "tr" || handle === "br") {
    return [{ value: b.x + b.w }]
  }
  return []
}

function computeYCandidates(
  b: Box,
  op: Op,
  handle?: Handle
): Candidate[] {
  if (op === "move") {
    return [
      { value: b.y },
      { value: b.y + b.h / 2 },
      { value: b.y + b.h },
    ]
  }
  if (!handle) return []
  if (handle === "t" || handle === "tl" || handle === "tr") {
    return [{ value: b.y }]
  }
  if (handle === "b" || handle === "bl" || handle === "br") {
    return [{ value: b.y + b.h }]
  }
  return []
}

// ─── Guide lines ────────────────────────────────────────────────────────────

function SnapGuidesLayer({
  guides,
  viewportW,
  viewportH,
}: {
  guides: GuideLine[]
  viewportW: number
  viewportH: number
}) {
  if (guides.length === 0) return null
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      {guides.map((g, i) => {
        if (g.axis === "x") {
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: g.value,
                top: 0,
                width: 2,
                height: viewportH,
                background: "var(--destructive)",
                transform: "translateX(-1px)",
              }}
            />
          )
        }
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: g.value,
              left: 0,
              height: 2,
              width: viewportW,
              background: "rgb(244, 114, 182)",
              transform: "translateY(-1px)",
            }}
          />
        )
      })}
    </div>
  )
}
