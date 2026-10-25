import { describe, expect, it } from "vitest"
import type { OverlayLayout } from "@/features/overlays/types"
import { applyDrag, MIN_SIZE } from "./drag"

const box = (x: number, y: number, w: number, h: number): OverlayLayout => ({
  x,
  y,
  w,
  h,
  style: { color: "#fff" },
})
const free = { keepRatio: false, snap: false }
const edges = (l: OverlayLayout) => ({
  L: l.x - l.w / 2,
  T: l.y - l.h / 2,
  R: l.x + l.w / 2,
  B: l.y + l.h / 2,
})

describe("applyDrag move", () => {
  it("translates the box and keeps its size and style", () => {
    const { layout } = applyDrag(box(0.3, 0.3, 0.2, 0.1), "move", 0.1, 0.05, free)
    expect(layout).toEqual({ x: 0.4, y: 0.35, w: 0.2, h: 0.1, style: { color: "#fff" } })
  })

  it("never leaves the stage", () => {
    const { layout } = applyDrag(box(0.9, 0.9, 0.2, 0.1), "move", 0.5, 0.5, free)
    const e = edges(layout)
    expect(e.R).toBeCloseTo(1)
    expect(e.B).toBeCloseTo(1)
    expect(layout.w).toBeCloseTo(0.2)
  })

  it("snaps the centre onto the middle guide", () => {
    const { layout, guides } = applyDrag(box(0.3, 0.3, 0.2, 0.1), "move", 0.195, 0, {
      keepRatio: false,
      snap: true,
    })
    expect(layout.x).toBe(0.5)
    expect(guides.v).toContain(0.5)
  })

  it("does not snap when snapping is off", () => {
    const { layout, guides } = applyDrag(box(0.3, 0.3, 0.2, 0.1), "move", 0.195, 0, free)
    expect(layout.x).toBeCloseTo(0.495)
    expect(guides.v).toHaveLength(0)
  })
})

describe("applyDrag resize", () => {
  it("east handle moves only the right edge", () => {
    const start = box(0.5, 0.5, 0.2, 0.2)
    const { layout } = applyDrag(start, "e", 0.1, 0.3, free)
    const e = edges(layout)
    expect(e.L).toBeCloseTo(0.4)
    expect(e.R).toBeCloseTo(0.7)
    expect(layout.h).toBeCloseTo(0.2)
  })

  it("north-west handle moves the top and left edges", () => {
    const { layout } = applyDrag(box(0.5, 0.5, 0.2, 0.2), "nw", -0.1, -0.1, free)
    const e = edges(layout)
    expect(e.L).toBeCloseTo(0.3)
    expect(e.T).toBeCloseTo(0.3)
    expect(e.R).toBeCloseTo(0.6)
    expect(e.B).toBeCloseTo(0.6)
  })

  it("never shrinks below the minimum size", () => {
    const { layout } = applyDrag(box(0.5, 0.5, 0.2, 0.2), "se", -1, -1, free)
    expect(layout.w).toBeCloseTo(MIN_SIZE)
    expect(layout.h).toBeCloseTo(MIN_SIZE)
  })

  it("clamps resizing to the stage", () => {
    const { layout } = applyDrag(box(0.5, 0.5, 0.2, 0.2), "se", 2, 2, free)
    const e = edges(layout)
    expect(e.R).toBeCloseTo(1)
    expect(e.B).toBeCloseTo(1)
  })

  it("Shift on a corner keeps the proportions, anchored at the opposite corner", () => {
    const start = box(0.3, 0.3, 0.2, 0.1)
    const { layout } = applyDrag(start, "se", 0.2, 0.01, { keepRatio: true, snap: false })
    expect(layout.w / layout.h).toBeCloseTo(2)
    const e = edges(layout)
    expect(e.L).toBeCloseTo(0.2)
    expect(e.T).toBeCloseTo(0.25)
    expect(layout.w).toBeCloseTo(0.4)
  })

  it("proportional resize stops at the stage edge without distorting", () => {
    const { layout } = applyDrag(box(0.8, 0.5, 0.2, 0.1), "se", 1, 1, {
      keepRatio: true,
      snap: false,
    })
    expect(layout.w / layout.h).toBeCloseTo(2)
    expect(edges(layout).R).toBeCloseTo(1)
  })

  it("snaps a dragged edge onto the stage edge", () => {
    const { layout, guides } = applyDrag(box(0.5, 0.5, 0.2, 0.2), "e", 0.395, 0, {
      keepRatio: false,
      snap: true,
    })
    expect(edges(layout).R).toBeCloseTo(1)
    expect(guides.v).toContain(1)
  })
})
