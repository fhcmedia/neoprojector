import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

const STORAGE_KEY = "neoprojector.uiScale"

const MIN_SCALE = 0.5
const MAX_SCALE = 2.0
const STEP = 0.05

// Snap to the nearest 5% and clamp — keeps the value off floating-point
// drift (0.95000000001) and inside a sane range.
function normalize(v: number): number {
  const snapped = Math.round(v / STEP) * STEP
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(snapped * 100) / 100))
}

// smartDefault guesses a comfortable scale on first run. We can't read the
// display's physical size (no web/native API exposes it), but screen.width
// is in CSS px — already divided down by the OS scale factor — so a Retina
// 4K reports ~1920 (no bump) while a 4K panel driven at 100% reports 3840
// (bump). It's a heuristic; the operator can always override.
function smartDefault(): number {
  if (typeof window === "undefined" || !window.screen) return 1
  const w = window.screen.width
  if (w >= 3200) return 1.5
  if (w >= 2560) return 1.3
  if (w >= 2048) return 1.15
  return 1
}

function readStored(): number {
  if (typeof window === "undefined") return 1
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw == null) return smartDefault()
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? normalize(n) : smartDefault()
}

type UiScaleState = {
  scale: number
  setScale: (v: number) => void
  increment: () => void
  decrement: () => void
  reset: () => void
  min: number
  max: number
}

const UiScaleContext = createContext<UiScaleState>({
  scale: 1,
  setScale: () => {},
  increment: () => {},
  decrement: () => {},
  reset: () => {},
  min: MIN_SCALE,
  max: MAX_SCALE,
})

// UiScaleProvider scales the operator UI via CSS zoom on this window's
// document. It mounts inside the _app shell only, so the separate output
// and splash windows (their own documents) are never touched — the
// audience never sees operator zoom. Persisted per-machine: the right
// scale depends on the physical monitor, which doesn't travel.
export function UiScaleProvider({ children }: { children: ReactNode }) {
  const [scale, setScaleState] = useState<number>(readStored)

  const setScale = useCallback((v: number) => setScaleState(normalize(v)), [])
  const increment = useCallback(
    () => setScaleState((s) => normalize(s + STEP)),
    []
  )
  const decrement = useCallback(
    () => setScaleState((s) => normalize(s - STEP)),
    []
  )
  const reset = useCallback(() => setScaleState(1), [])

  // Apply + persist.
  useEffect(() => {
    if (typeof document !== "undefined") {
      // zoom takes a unitless factor; reflows like page-zoom on the
      // engines we ship on, so the h-screen shell still fits.
      document.documentElement.style.zoom = String(scale)
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(scale))
    }
  }, [scale])

  // Cmd/Ctrl +/-/0 — the operator's muscle memory for zoom. We
  // preventDefault so the webview's built-in zoom doesn't double-fire.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === "=" || e.key === "+") {
        e.preventDefault()
        increment()
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault()
        decrement()
      } else if (e.key === "0") {
        e.preventDefault()
        reset()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [increment, decrement, reset])

  return (
    <UiScaleContext.Provider
      value={{
        scale,
        setScale,
        increment,
        decrement,
        reset,
        min: MIN_SCALE,
        max: MAX_SCALE,
      }}
    >
      {children}
    </UiScaleContext.Provider>
  )
}

export function useUiScale() {
  return useContext(UiScaleContext)
}
