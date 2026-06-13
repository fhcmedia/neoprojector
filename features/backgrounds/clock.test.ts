import { describe, expect, it, vi, afterEach } from "vitest"
import { sharedTimeAt, sharedTime } from "./clock"

describe("sharedTime", () => {
  afterEach(() => vi.useRealTimers())

  it("is day-anchored: value stays in [0, 86400)", () => {
    // 2026-06-12T18:30:00Z — arbitrary mid-day instant
    const ms = Date.UTC(2026, 5, 12, 18, 30, 0)
    const t = sharedTimeAt(ms)
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThan(86400)
  })

  it("two reads in the same instant agree (determinism across windows)", () => {
    const ms = Date.UTC(2026, 5, 12, 9, 15, 30, 250)
    expect(sharedTimeAt(ms)).toBe(sharedTimeAt(ms))
  })

  it("advances by the wall-clock delta within a day", () => {
    const base = Date.UTC(2026, 5, 12, 9, 0, 0)
    expect(sharedTimeAt(base + 5000) - sharedTimeAt(base)).toBeCloseTo(5, 6)
  })

  it("sharedTime() reads the live system clock", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 12, 0, 0, 10)))
    expect(sharedTime()).toBeCloseTo(10, 6)
  })
})
