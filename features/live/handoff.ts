// Instant-update handoff, operator-window side (see services/liveupdate).
//
// The running version answers "liveupdate:snapshot-request" with what
// the operator window holds: what's live, the active overlays, the open
// service/item (sessionStorage + the URL). The new version calls
// restoreFromHandoff() before it renders anything, so its first live
// push is the same payload the screens already show.

import { Service as LiveUpdate } from "@/bindings/neoprojector/services/liveupdate"
import type { BackgroundSnapshot } from "@/bindings/neoprojector/services/displays"
import type { ActiveOverlay, LiveSlide } from "@/features/live/live-context"

export type OperatorSnapshot = {
  url: string
  session: Record<string, string>
  live: LiveSlide | null
  overlays: ActiveOverlay[]
  serviceBackground: BackgroundSnapshot | null
}

let restored: OperatorSnapshot | null = null

// restoredLiveState is the live state carried over by an instant
// update (null on a normal launch). LiveProvider seeds from it.
export function restoredLiveState(): OperatorSnapshot | null {
  return restored
}

// restoreFromHandoff pulls the snapshot (if this launch is an instant
// update) and puts the session state and URL back. Must run before the
// router is created: it reads the URL once.
export async function restoreFromHandoff(): Promise<void> {
  let raw = ""
  try {
    raw = await LiveUpdate.TakeSnapshot()
  } catch {
    return
  }
  if (!raw) return
  try {
    const snap = JSON.parse(raw) as OperatorSnapshot
    for (const [k, v] of Object.entries(snap.session ?? {})) {
      try {
        window.sessionStorage.setItem(k, v)
      } catch {
        // Storage refused: the panes just start fresh.
      }
    }
    if (snap.url) window.history.replaceState(null, "", snap.url)
    restored = snap
  } catch {
    // A malformed snapshot: start fresh (the screens keep the Go-side
    // payload until the operator acts).
  }
}

// snapshotSession copies the operator window's sessionStorage.
export function snapshotSession(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i)
      // The startup notice should announce the new version.
      if (k === null || k === "neoprojector.startupNoticeShown") continue
      out[k] = window.sessionStorage.getItem(k) ?? ""
    }
  } catch {
    // Unreadable storage: hand off without it.
  }
  return out
}
