import { describe, expect, it } from "vitest"
import type { VideoInfo } from "@/bindings/neoprojector/services/media"
import { videoProblem } from "./video-problem"

const info = (codec: string, name: string, support: string) =>
  ({ codec, name, support }) as VideoInfo

describe("videoProblem", () => {
  it("says nothing for a video that plays", () => {
    expect(videoProblem(info("avc1", "H.264", "yes"), "ok")).toBeNull()
    expect(videoProblem(info("avc1", "H.264", "yes"), "pending")).toBeNull()
  })

  it("HEVC that this machine can decode is fine", () => {
    expect(videoProblem(info("hvc1", "HEVC (H.265)", "maybe"), "ok")).toBeNull()
  })

  it("HEVC with no picture points at the HEVC extension", () => {
    const p = videoProblem(info("hvc1", "HEVC (H.265)", "maybe"), "no-picture")
    expect(p?.short).toBe("Can't play here — HEVC")
    expect(p?.detail).toMatch(/HEVC Video Extensions/)
  })

  it("ProRes is flagged even before the player reports anything", () => {
    const p = videoProblem(info("apcn", "Apple ProRes 422", "no"), "pending")
    expect(p?.short).toBe("Can't play here — Apple ProRes 422")
    expect(p?.detail).toMatch(/H\.264/)
  })

  it("an unknown file that errors still gets a message", () => {
    expect(videoProblem(info("", "Unknown format", "unknown"), "error")?.short).toBe(
      "Can't play this video"
    )
    expect(videoProblem(undefined, "error")?.short).toBe("Can't play this video")
  })
})
