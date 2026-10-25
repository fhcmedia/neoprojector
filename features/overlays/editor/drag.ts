import type { OverlayLayout } from "@/features/overlays/types"

// Drag math for the overlay editor canvas.
//
// Layouts are centre-based (x/y = box centre, all values 0..1 of the
// stage). Drags work on edges, then convert back. The box always stays
// fully on the stage and never shrinks below MIN_SIZE.

export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"
export type Guides = { v: number[]; h: number[] }
type Edges = { L: number; T: number; R: number; B: number }

// Smallest box, as a fraction of the stage, and how close (fraction of
// the stage) an edge/centre must come to a guide to snap onto it.
export const MIN_SIZE = 0.02
export const SNAP = 0.012

function toEdges(l: OverlayLayout): Edges {
  return { L: l.x - l.w / 2, T: l.y - l.h / 2, R: l.x + l.w / 2, B: l.y + l.h / 2 }
}

function fromEdges(e: Edges, style: OverlayLayout["style"]): OverlayLayout {
  return {
    x: round3((e.L + e.R) / 2),
    y: round3((e.T + e.B) / 2),
    w: round3(e.R - e.L),
    h: round3(e.B - e.T),
    style,
  }
}

export function applyDrag(
  start: OverlayLayout,
  handle: Handle,
  dx: number,
  dy: number,
  opts: { keepRatio: boolean; snap: boolean }
): { layout: OverlayLayout; guides: Guides } {
  const s = toEdges(start)
  const guides: Guides = { v: [], h: [] }

  if (handle === "move") {
    const w = s.R - s.L
    const h = s.B - s.T
    let L = clamp(s.L + dx, 0, 1 - w)
    let T = clamp(s.T + dy, 0, 1 - h)
    if (opts.snap) {
      const sx = snapOffset([L, L + w / 2, L + w], [0, 0.5, 1])
      if (sx) {
        L = clamp(L + sx.delta, 0, 1 - w)
        guides.v.push(sx.guide)
      }
      const sy = snapOffset([T, T + h / 2, T + h], [0, 0.5, 1])
      if (sy) {
        T = clamp(T + sy.delta, 0, 1 - h)
        guides.h.push(sy.guide)
      }
    }
    return { layout: fromEdges({ L, T, R: L + w, B: T + h }, start.style), guides }
  }

  const e: Edges = { ...s }
  const horiz = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0
  const vert = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0

  if (opts.keepRatio && horiz !== 0 && vert !== 0) {
    // Corner drag, proportional: scale from the opposite corner.
    const w0 = s.R - s.L
    const h0 = s.B - s.T
    const ax = horiz > 0 ? s.L : s.R
    const ay = vert > 0 ? s.T : s.B
    const scale = Math.max((w0 + horiz * dx) / w0, (h0 + vert * dy) / h0)
    const maxScale = Math.min(
      (horiz > 0 ? 1 - ax : ax) / w0,
      (vert > 0 ? 1 - ay : ay) / h0
    )
    const minScale = MIN_SIZE / Math.min(w0, h0)
    const k = clamp(scale, minScale, maxScale)
    const w = w0 * k
    const h = h0 * k
    e.L = horiz > 0 ? ax : ax - w
    e.R = horiz > 0 ? ax + w : ax
    e.T = vert > 0 ? ay : ay - h
    e.B = vert > 0 ? ay + h : ay
    return { layout: fromEdges(e, start.style), guides }
  }

  if (horiz > 0) e.R = clamp(s.R + dx, s.L + MIN_SIZE, 1)
  if (horiz < 0) e.L = clamp(s.L + dx, 0, s.R - MIN_SIZE)
  if (vert > 0) e.B = clamp(s.B + dy, s.T + MIN_SIZE, 1)
  if (vert < 0) e.T = clamp(s.T + dy, 0, s.B - MIN_SIZE)
  if (opts.snap) {
    if (horiz !== 0) {
      const edge = horiz > 0 ? e.R : e.L
      const sx = snapOffset([edge], [0, 0.5, 1])
      const next = sx ? edge + sx.delta : edge
      if (sx && (horiz > 0 ? next - e.L >= MIN_SIZE : e.R - next >= MIN_SIZE)) {
        if (horiz > 0) e.R = next
        else e.L = next
        guides.v.push(sx.guide)
      }
    }
    if (vert !== 0) {
      const edge = vert > 0 ? e.B : e.T
      const sy = snapOffset([edge], [0, 0.5, 1])
      const next = sy ? edge + sy.delta : edge
      if (sy && (vert > 0 ? next - e.T >= MIN_SIZE : e.B - next >= MIN_SIZE)) {
        if (vert > 0) e.B = next
        else e.T = next
        guides.h.push(sy.guide)
      }
    }
  }
  return { layout: fromEdges(e, start.style), guides }
}

// snapOffset finds the closest (point, guide) pair within SNAP and
// returns the shift that lands the point on the guide.
function snapOffset(
  points: number[],
  targets: number[]
): { delta: number; guide: number } | null {
  let best: { delta: number; guide: number } | null = null
  for (const p of points) {
    for (const t of targets) {
      const d = t - p
      if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.delta))) {
        best = { delta: d, guide: t }
      }
    }
  }
  return best
}

export function sameBox(a: OverlayLayout, b: OverlayLayout): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
