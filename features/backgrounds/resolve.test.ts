import { describe, expect, it } from "vitest"
import { resolveBackgroundId, snapshotFor } from "./resolve"
import { defaultBackgrounds } from "./presets"
import type { BackgroundDoc } from "./presets"

const userRow: BackgroundDoc = {
  id: 7,
  name: "Custom",
  engine: "gradflow",
  config_json: '{"type":"silk"}',
}
const all = [...defaultBackgrounds, userRow]

describe("resolveBackgroundId — nearest wins, 0 = unset", () => {
  it("item override wins over everything", () => {
    expect(resolveBackgroundId(7, -9001, -9002)).toBe(7)
  })
  it("falls back to section when item unset", () => {
    expect(resolveBackgroundId(0, -9001, -9002)).toBe(-9001)
  })
  it("falls back to service when item+section unset", () => {
    expect(resolveBackgroundId(0, 0, -9002)).toBe(-9002)
  })
  it("null when the whole chain is unset", () => {
    expect(resolveBackgroundId(0, 0, 0)).toBeNull()
    expect(resolveBackgroundId()).toBeNull()
    expect(resolveBackgroundId(undefined, null, 0)).toBeNull()
  })
})

describe("snapshotFor", () => {
  it("resolves a seed by negative id", () => {
    const snap = snapshotFor(-9003, all)
    expect(snap).not.toBeNull()
    expect(snap!.background_id).toBe(-9003)
    expect(snap!.engine).toBe("gradflow")
    expect(JSON.parse(snap!.config_json).type).toBe("silk")
  })
  it("resolves a user row by positive id", () => {
    expect(snapshotFor(7, all)!.background_id).toBe(7)
  })
  it("returns null for a deleted/unknown row so inheritance continues", () => {
    expect(snapshotFor(999, all)).toBeNull()
  })
  it("returns null for unset ids and missing lists", () => {
    expect(snapshotFor(0, all)).toBeNull()
    expect(snapshotFor(null, all)).toBeNull()
    expect(snapshotFor(7, undefined)).toBeNull()
  })
  it("a shadow row at a seed id wins over the seed (merged upstream)", () => {
    // The merge in useBackgrounds replaces the seed entry; snapshotFor
    // just reads whatever doc owns the id in the list it's given.
    const shadow: BackgroundDoc = {
      id: -9001,
      name: "Godrays (edited)",
      engine: "gradflow",
      config_json: '{"type":"stripe","speed":0.5}',
    }
    const merged = [shadow, ...all.filter((b) => b.id !== -9001)]
    expect(JSON.parse(snapshotFor(-9001, merged)!.config_json).speed).toBe(0.5)
  })
})
