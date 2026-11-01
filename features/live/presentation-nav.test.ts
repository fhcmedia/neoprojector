import { describe, expect, it } from "vitest"
import { dwellMs, includedCount, nextIndex, prevIndex } from "./presentation-nav"

const S = (...ex: boolean[]) => ex.map((excluded) => ({ excluded }))

describe("presentation navigation", () => {
  it("steps over excluded slides", () => {
    const s = S(false, true, true, false, false)
    expect(nextIndex(s, 0, false)).toBe(3)
    expect(prevIndex(s, 3, false)).toBe(0)
  })
  it("starts at the first included slide", () => {
    expect(nextIndex(S(true, false), -1, false)).toBe(1)
  })
  it("stops at the ends without loop, wraps with it", () => {
    const s = S(false, false, true)
    expect(nextIndex(s, 1, false)).toBe(-1)
    expect(nextIndex(s, 1, true)).toBe(0)
    expect(prevIndex(s, 0, false)).toBe(-1)
    expect(prevIndex(s, 0, true)).toBe(1)
  })
  it("handles a single included slide and none at all", () => {
    expect(nextIndex(S(true, false, true), 1, true)).toBe(-1)
    expect(nextIndex(S(true, true), -1, true)).toBe(-1)
    expect(includedCount(S(true, false, false))).toBe(2)
  })
  it("leaves an excluded current slide for the next included one", () => {
    // The operator clicked an excluded slide; next continues normally.
    expect(nextIndex(S(false, true, false), 1, false)).toBe(2)
  })
  it("uses a slide's own duration, else the interval", () => {
    expect(dwellMs({ durationMs: 8000 }, 5000)).toBe(8000)
    expect(dwellMs({ durationMs: 0 }, 5000)).toBe(5000)
    expect(dwellMs(undefined, 100)).toBe(250)
  })
})
