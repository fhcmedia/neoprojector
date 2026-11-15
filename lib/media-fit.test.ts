import { describe, expect, it } from "vitest"
import { resolveFit } from "./media-fit"

describe("resolveFit", () => {
  it("keeps a media ref's own framing", () => {
    expect(resolveFit("contain", "cover")).toBe("contain")
    expect(resolveFit("cover", "contain")).toBe("cover")
  })
  it("falls back for unset, empty and legacy loop", () => {
    expect(resolveFit(undefined, "contain")).toBe("contain")
    expect(resolveFit("", "cover")).toBe("cover")
    expect(resolveFit("loop", "contain")).toBe("contain")
  })
})
