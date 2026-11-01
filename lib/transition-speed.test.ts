import { describe, expect, it } from "vitest"
import { TRANSITION_PRESETS, withSpeed } from "./transition-speed"

describe("transition speed", () => {
  it("keeps the template's own transition when unset", () => {
    const t = { kind: "slide-up", duration_ms: 400 }
    expect(withSpeed(t, null)).toBe(t)
  })
  it("overrides the duration but keeps the style", () => {
    expect(withSpeed({ kind: "slide-up", duration_ms: 400 }, 2000)).toEqual({ kind: "slide-up", duration_ms: 2000 })
    expect(withSpeed(undefined, 1000)).toEqual({ kind: "fade", duration_ms: 1000 })
    expect(withSpeed({ kind: "blur", duration_ms: 400 }, 0)).toEqual({ kind: "blur", duration_ms: 0 })
  })
  it("offers the default plus increasing speeds", () => {
    expect(TRANSITION_PRESETS[0].value).toBe("default")
    const ms = TRANSITION_PRESETS.slice(1).map((p) => Number(p.value))
    expect([...ms].sort((a, b) => a - b)).toEqual(ms)
  })
})
