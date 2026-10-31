import { describe, expect, it } from "vitest"
import type { BackgroundSnapshot } from "@/bindings/neoprojector/services/displays"
import {
  backgroundKey,
  layerOpacity,
  layerReady,
  nextLayers,
  type BgLayer,
} from "./background-crossfade"

const bg = (id: number, cfg = "{}"): BackgroundSnapshot =>
  ({ background_id: id, engine: "gradflow", config_json: cfg }) as BackgroundSnapshot

const opacities = (ls: BgLayer[]) => ls.map(layerOpacity)

describe("background crossfade layers", () => {
  it("a new background mounts invisible until its first frame", () => {
    const ls = nextLayers([], bg(1), 1)
    expect(opacities(ls)).toEqual([0])
    expect(opacities(layerReady(ls, 1))).toEqual([1])
  })

  it("the old background stays fully visible until the new one has painted", () => {
    let ls = layerReady(nextLayers([], bg(1), 1), 1)
    ls = nextLayers(ls, bg(2), 2)
    // New layer still compiling: old one at 1, new at 0 — never black.
    expect(opacities(ls)).toEqual([1, 0])
    expect(ls.map((l) => l.doomed)).toEqual([false, false])
    ls = layerReady(ls, 2)
    // New fades in over the old, which stays opaque underneath, then goes.
    expect(opacities(ls)).toEqual([1, 1])
    expect(ls.map((l) => l.doomed)).toEqual([true, false])
  })

  it("clearing the background fades everything to black", () => {
    let ls = layerReady(nextLayers([], bg(1), 1), 1)
    ls = nextLayers(ls, null, 2)
    expect(opacities(ls)).toEqual([0])
    expect(ls[0].doomed).toBe(true)
  })

  it("editing the same background updates it in place, no fade", () => {
    let ls = layerReady(nextLayers([], bg(1, '{"a":1}'), 1), 1)
    ls = nextLayers(ls, bg(1, '{"a":2}'), 2)
    expect(ls).toHaveLength(1)
    expect(ls[0].bg.config_json).toBe('{"a":2}')
    expect(opacities(ls)).toEqual([1])
  })

  it("a stale ready signal never dooms a newer layer", () => {
    let ls = nextLayers([], bg(1), 1)
    ls = nextLayers(ls, bg(2), 2)
    // Layer 1 finishes compiling after layer 2 was queued above it.
    ls = layerReady(ls, 1)
    expect(ls.map((l) => l.doomed)).toEqual([false, false])
    ls = layerReady(ls, 2)
    expect(ls.map((l) => l.doomed)).toEqual([true, false])
  })

  it("switching back to a background that is still fading out starts fresh", () => {
    let ls = layerReady(nextLayers([], bg(1), 1), 1)
    ls = layerReady(nextLayers(ls, bg(2), 2), 2) // 1 is now doomed
    ls = nextLayers(ls, bg(1), 3)
    expect(ls.map((l) => l.uid)).toEqual([1, 2, 3])
    expect(opacities(ls)).toEqual([1, 1, 0])
  })

  it("unsaved backgrounds are keyed by content", () => {
    expect(backgroundKey(bg(0, '{"x":1}'))).not.toBe(backgroundKey(bg(0, '{"x":2}')))
    expect(backgroundKey(bg(5, '{"x":1}'))).toBe(backgroundKey(bg(5, '{"x":2}')))
  })
})
