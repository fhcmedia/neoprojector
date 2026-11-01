import { useSyncExternalStore } from "react"

// Global slide transition speed (Settings → Output). null = each
// template's / presentation's own transition time (the default); a
// number = every slide, image and video change on every screen takes
// that long, keeping each transition's style (fade, slide…).
//
// Stored in localStorage, which the operator window and every output
// window share (same origin); the "storage" event carries a change to
// the other windows live, so open projector windows follow at once.

const KEY = "neoprojector.transitionMs"

export const TRANSITION_PRESETS: readonly { value: string; label: string }[] = [
  { value: "default", label: "Each template's own (default)" },
  { value: "0", label: "Instant (cut)" },
  { value: "250", label: "Quick — 0.25 s" },
  { value: "500", label: "Normal — 0.5 s" },
  { value: "1000", label: "Slow — 1 s" },
  { value: "2000", label: "Very slow — 2 s" },
  { value: "3000", label: "Extra slow — 3 s" },
]

const listeners = new Set<() => void>()

export function readTransitionMs(): number | null {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null || raw === "") return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : null
  } catch {
    return null
  }
}

export function setTransitionMs(ms: number | null) {
  try {
    if (ms === null) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, String(ms))
  } catch {
    // Storage unavailable: setting won't stick.
  }
  for (const l of listeners) l()
}

function subscribe(l: () => void) {
  listeners.add(l)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) l()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(l)
    window.removeEventListener("storage", onStorage)
  }
}

export function useTransitionMs(): number | null {
  return useSyncExternalStore(subscribe, readTransitionMs, () => null)
}

// withSpeed applies the global speed to a transition, keeping its kind.
export function withSpeed(
  t: { kind: string; duration_ms: number } | undefined,
  ms: number | null,
  fallbackKind = "fade"
): { kind: string; duration_ms: number } | undefined {
  if (ms === null) return t
  return { kind: t?.kind ?? fallbackKind, duration_ms: ms }
}
