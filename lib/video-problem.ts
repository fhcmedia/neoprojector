import type { VideoInfo } from "@/bindings/neoprojector/services/media"

// Pure part of lib/video-support (no runtime imports, so it unit-tests
// in node): the playback states and the operator-facing message.

export type PlaybackState = "pending" | "ok" | "no-picture" | "error"

// videoProblem turns the two signals into an operator-facing message,
// or null when there's nothing to say. The runtime check is the source
// of truth for THIS machine; the codec says why and what to do.
export function videoProblem(
  info: VideoInfo | undefined,
  playback: PlaybackState
): { short: string; detail: string } | null {
  const failed = playback === "no-picture" || playback === "error"
  const known = info?.support === "no"
  if (!failed && !known) return null
  const name = info?.name && info.name !== "Unknown format" ? info.name : null
  const isHevc = info?.codec === "hvc1" || info?.codec === "hev1" ||
    info?.codec === "dvh1" || info?.codec === "dvhe"
  if (isHevc) {
    return {
      short: "Can't play here — HEVC",
      detail:
        "This video is HEVC (H.265), and this computer can't decode it. " +
        "Install Microsoft's \"HEVC Video Extensions\" from the Microsoft " +
        "Store, or export/convert the video to MP4 (H.264).",
    }
  }
  return {
    short: name ? `Can't play here — ${name}` : "Can't play this video",
    detail:
      (name ? `This video is ${name}, which ` : "This video's format ") +
      "can't be played in NeoProjector. Export or convert it to MP4 " +
      "(H.264) — e.g. HandBrake's \"Fast 1080p30\" preset — and import " +
      "that instead.",
  }
}
