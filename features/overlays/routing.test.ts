import { describe, expect, it } from "vitest"
import { routeOverlays } from "./routing"

type O = { id: string; kind: string; rulesJSON: string }
const o = (id: string, kind: string, rules: object | string = ""): O => ({
  id,
  kind,
  rulesJSON: typeof rules === "string" ? rules : JSON.stringify(rules),
})
const route = (list: O[], displayId: number) => {
  const r = routeOverlays(list, displayId, (x) => x)
  return { under: r.under.map((x) => x.id), top: r.top.map((x) => x.id), cover: r.coverSlide }
}

describe("routeOverlays", () => {
  it("shows overlays on every display when display_ids is absent", () => {
    expect(route([o("clock", "clock", { cover_slide: false })], 7).under).toEqual(["clock"])
  })

  it("drops overlays targeted at other displays", () => {
    const list = [o("a", "clock", { display_ids: [1] }), o("b", "clock", { display_ids: [2] })]
    expect(route(list, 1).under).toEqual(["a"])
    expect(route(list, 2).under).toEqual(["b"])
  })

  it("an empty display_ids list shows nowhere", () => {
    expect(route([o("a", "clock", { display_ids: [] })], 1)).toEqual({
      under: [],
      top: [],
      cover: false,
    })
  })

  it("puts sticky overlays on the top layer", () => {
    const list = [o("timer", "clock", { sticky: true }), o("msg", "message", { sticky: false })]
    expect(route(list, 1)).toEqual({ under: ["msg"], top: ["timer"], cover: false })
  })

  it("sermon timers are sticky by default, even with empty rules", () => {
    expect(route([o("t", "sermon_timer", "")], 1).top).toEqual(["t"])
    expect(route([o("t", "sermon_timer", { cover_slide: false })], 1).top).toEqual(["t"])
  })

  it("an explicit sticky:false overrides the kind default", () => {
    expect(route([o("t", "sermon_timer", { sticky: false })], 1).under).toEqual(["t"])
  })

  it("hide_on_content overlays step aside while content is live", () => {
    const list = [
      o("timer", "sermon_timer", { hide_on_content: true }),
      o("clock", "clock", { cover_slide: false }),
    ]
    const live = routeOverlays(list, 1, (x) => x, { contentLive: true })
    expect(live.top.map((x) => x.id)).toEqual([])
    expect(live.under.map((x) => x.id)).toEqual(["clock"])
    // Content cleared -> the timer is back on its sticky top layer.
    const idle = routeOverlays(list, 1, (x) => x, { contentLive: false })
    expect(idle.top.map((x) => x.id)).toEqual(["timer"])
  })

  it("a hidden overlay cannot cover the slide", () => {
    const list = [o("cd", "countdown", { cover_slide: true, hide_on_content: true })]
    expect(routeOverlays(list, 1, (x) => x, { contentLive: true }).coverSlide).toBe(false)
  })

  it("only overlays shown on this display can cover the slide", () => {
    const list = [o("cd", "countdown", { cover_slide: true, display_ids: [2] })]
    expect(route(list, 1).cover).toBe(false)
    expect(route(list, 2).cover).toBe(true)
  })
})
