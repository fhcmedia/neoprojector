import { useSyncExternalStore } from "react"
import { Events } from "@wailsio/runtime"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { OptimizeStatus } from "@/bindings/neoprojector/services/media"

// Playback copies (see services/media/optimize.go).
//
// The Go side converts heavy videos (HEVC, ProRes, 4K, huge bitrates) into
// a smooth H.264 copy that replaces the original under the same media id,
// and reports progress as "media:optimize" events. This module keeps:
//   - the latest status per media id, for the "Optimizing 45%" badges;
//   - a version per media id, bumped when a copy is swapped in, which
//     videoAssetUrl() puts in the URL so every <video> on every window
//     reloads from the new file instead of continuing on the old one.
// One module-level subscription per window, shared by every hook.

export type { OptimizeStatus }

const statuses = new Map<number, OptimizeStatus>()
const versions = new Map<number, number>()
const listeners = new Set<() => void>()
let snapshot = 0
let started = false

function emit() {
  snapshot++
  for (const l of listeners) l()
}

function apply(st: OptimizeStatus) {
  if (st.state === "cleared") statuses.delete(st.media_id)
  else statuses.set(st.media_id, st)
  if (st.state === "done") {
    versions.set(st.media_id, (versions.get(st.media_id) ?? 0) + 1)
  }
  emit()
}

function start() {
  if (started) return
  started = true
  Events.On("media:optimize", (event: { data?: OptimizeStatus }) => {
    if (event?.data) apply(event.data)
  })
  Media.OptimizeStatus()
    .then((list) => {
      for (const st of list ?? []) {
        // Don't let the initial snapshot override a newer event.
        if (!statuses.has(st.media_id)) statuses.set(st.media_id, st)
      }
      emit()
    })
    .catch(() => {})
}

function subscribe(l: () => void) {
  start()
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

// useMediaRevision re-renders the caller whenever any status or version
// changes; the value itself is only a change counter.
export function useMediaRevision(): number {
  return useSyncExternalStore(subscribe, () => snapshot)
}

// mediaVersion is the number of times this media's file was replaced in
// this session (0 = original). Callers that render it must also call
// useMediaRevision() (useMediaServerConn does) to stay current.
export function mediaVersion(mediaId: number): number {
  return versions.get(mediaId) ?? 0
}

export function useOptimizeStatus(
  mediaId: number | null | undefined
): OptimizeStatus | undefined {
  useMediaRevision()
  return mediaId ? statuses.get(mediaId) : undefined
}

// isOptimizing: a copy is on its way (show progress, not an error).
export function isOptimizing(st: OptimizeStatus | undefined): boolean {
  return (
    !!st &&
    (st.state === "queued" ||
      st.state === "downloading" ||
      st.state === "converting" ||
      st.state === "waiting_live")
  )
}

export function optimizeLabel(st: OptimizeStatus): string {
  switch (st.state) {
    case "queued":
      return "Optimizing — queued"
    case "downloading":
      return `Getting converter ${st.pct}%`
    case "converting":
      return st.quality && st.quality !== "1080p"
        ? `Making ${st.quality} copy ${st.pct}%`
        : `Optimizing ${st.pct}%`
    case "waiting_live":
      return "Optimizing after the service"
    case "failed":
      return "Couldn't optimize"
    default:
      return ""
  }
}

export function retryOptimize(mediaId: number) {
  return Media.RetryOptimize(mediaId)
}
