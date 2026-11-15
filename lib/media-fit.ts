import { useSyncExternalStore } from "react"

// How pictures and videos fill the screen (Settings → Output).
// "contain" (the default) shows the whole picture, with black bars where
// its shape differs from the screen's (portrait photos, 4:3 projectors);
// "cover" fills the screen and crops whatever spills over the edges.
//
// Only media without a framing of its own follows this: deck pages are
// always shown whole, and template backgrounds always fill.
//
// Stored in localStorage like the transition speed (lib/transition-speed.ts)
// so the operator window and every output window share it; the "storage"
// event carries a change to open projector windows at once.

export type MediaFit = "contain" | "cover"

const KEY = "neoprojector.mediaFit"

export const MEDIA_FIT_OPTIONS: readonly { value: MediaFit; label: string }[] = [
  { value: "contain", label: "Show the whole picture (default)" },
  { value: "cover", label: "Fill the screen (crops edges)" },
]

const listeners = new Set<() => void>()

export function readMediaFit(): MediaFit {
  try {
    return window.localStorage.getItem(KEY) === "cover" ? "cover" : "contain"
  } catch {
    return "contain"
  }
}

export function setMediaFit(fit: MediaFit) {
  try {
    if (fit === "contain") window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, fit)
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

export function useMediaFit(): MediaFit {
  return useSyncExternalStore(subscribe, readMediaFit, () => "contain")
}

// resolveFit: a media ref's own framing wins ("contain"/"cover");
// anything else ("", legacy "loop", unset) falls back to `fallback`.
export function resolveFit(mode: string | undefined, fallback: MediaFit): MediaFit {
  return mode === "contain" || mode === "cover" ? mode : fallback
}
