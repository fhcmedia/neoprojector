import { useEffect, useState, type RefObject } from "react"
import { useQuery } from "@tanstack/react-query"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { VideoInfo } from "@/bindings/neoprojector/services/media"
import type { PlaybackState } from "./video-problem"
import { mediaVersion, useMediaRevision } from "./media-optimize"

export { videoProblem, type PlaybackState } from "./video-problem"

// Explaining black videos.
//
// WebView2 decodes H.264/VP9/AV1 everywhere, HEVC only where the PC has
// hardware support + Microsoft's HEVC extension, and never ProRes. An
// unsupported file imports fine and then just shows black (ProRes even
// plays its audio with no picture), which reads as "the app is broken".
// Two signals combine into a message:
//   - the codec, read from the file by the Go side (Media.VideoInfo);
//   - what this machine's player actually managed (useVideoPlayback).

// useVideoInfo: the file's codec + expected support. Codecs never change
// for a stored file, so cache forever…
export function useVideoInfo(mediaId: number | null | undefined) {
  // …except when the file is replaced by its playback copy.
  useMediaRevision()
  const v = mediaId ? mediaVersion(mediaId) : 0
  return useQuery({
    queryKey: ["media", "video-info", mediaId, v],
    queryFn: () => Media.VideoInfo(mediaId!) as unknown as Promise<VideoInfo>,
    enabled: !!mediaId,
    staleTime: Infinity,
  })
}

// useVideoPlayback watches a <video> and reports whether this machine
// can actually draw it: "no-picture" when data loaded but there is no
// video frame size (decoder missing — audio may still play), "error"
// when the element gave up.
export function useVideoPlayback(
  ref: RefObject<HTMLMediaElement | null>,
  src: string | undefined
): PlaybackState {
  const [state, setState] = useState<PlaybackState>("pending")
  useEffect(() => {
    setState("pending")
    const el = ref.current
    if (!el || !src) return
    // Audio elements have no frame size; only judge real <video>s.
    const check = () =>
      setState(
        !(el instanceof HTMLVideoElement) || el.videoWidth > 0 ? "ok" : "no-picture"
      )
    const fail = () => setState("error")
    if (el.error) fail()
    else if (el.readyState >= 2) check()
    el.addEventListener("loadeddata", check)
    el.addEventListener("error", fail)
    return () => {
      el.removeEventListener("loadeddata", check)
      el.removeEventListener("error", fail)
    }
  }, [ref, src])
  return state
}
