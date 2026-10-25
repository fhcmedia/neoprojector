import { describe, expect, it } from "vitest"
import {
  clockFrom,
  correction,
  hasEnded,
  NUDGE,
  rawPosition,
  targetPosition,
  type PlayClock,
} from "./media-sync"

const T0 = 1_000_000
const clock = (p: Partial<PlayClock> = {}): PlayClock => ({
  playing: true,
  loop: false,
  anchorMs: T0,
  anchorPos: 0,
  ...p,
})

describe("clock position", () => {
  it("advances in real time while playing", () => {
    expect(rawPosition(clock(), T0 + 2500)).toBeCloseTo(2.5)
    expect(rawPosition(clock({ anchorPos: 10 }), T0 + 1000)).toBeCloseTo(11)
  })

  it("holds still while paused", () => {
    expect(rawPosition(clock({ playing: false, anchorPos: 42 }), T0 + 60_000)).toBe(42)
  })

  it("never runs backwards for a slightly-future anchor", () => {
    expect(rawPosition(clock({ anchorPos: 5 }), T0 - 200)).toBe(5)
  })

  it("wraps when looping and holds the last frame when not", () => {
    expect(targetPosition(clock({ loop: true }), T0 + 25_000, 10)).toBeCloseTo(5)
    expect(targetPosition(clock(), T0 + 25_000, 10)).toBeCloseTo(9.95)
    expect(hasEnded(clock(), T0 + 25_000, 10)).toBe(true)
    expect(hasEnded(clock({ loop: true }), T0 + 25_000, 10)).toBe(false)
  })

  it("two surfaces mounted at different times agree on the position", () => {
    const c = clock({ anchorPos: 3 })
    // A window that opened 7.2s after the anchor and one that has been
    // up the whole time must both target the same frame "now".
    const now = T0 + 7200
    expect(targetPosition(c, now, 197)).toBe(targetPosition(c, now, 197))
    expect(targetPosition(c, now, 197)).toBeCloseTo(10.2)
  })
})

describe("drift correction", () => {
  it("seeks when far off", () => {
    expect(correction(4, 10.2, true)).toEqual({ seek: 10.2, rate: 1 })
  })

  it("nudges the rate for small drift, in the right direction", () => {
    expect(correction(10.0, 10.2, true)).toEqual({ seek: null, rate: 1 + NUDGE })
    expect(correction(10.4, 10.2, true)).toEqual({ seek: null, rate: 1 - NUDGE })
  })

  it("leaves an in-sync element alone", () => {
    expect(correction(10.21, 10.2, true)).toEqual({ seek: null, rate: 1 })
  })

  it("parks exactly on the frame when paused", () => {
    expect(correction(10.1, 10.2, false)).toEqual({ seek: 10.2, rate: 1 })
    expect(correction(10.2, 10.2, false)).toEqual({ seek: null, rate: 1 })
  })
})

describe("clockFrom", () => {
  it("is null for legacy fills without an anchor", () => {
    expect(clockFrom({ playing: true })).toBeNull()
    expect(clockFrom(null)).toBeNull()
  })

  it("defaults playing to true like the live payload does", () => {
    expect(clockFrom({ anchorMs: T0 })).toEqual({
      playing: true,
      loop: false,
      anchorMs: T0,
      anchorPos: 0,
    })
  })
})
