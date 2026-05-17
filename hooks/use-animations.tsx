import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { MotionGlobalConfig } from "motion/react"

const STORAGE_KEY = "neoprojector.animationsEnabled"

function readStored(): boolean {
  if (typeof window === "undefined") return true
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored === null ? true : stored === "true"
}

// Output windows are audience-facing — the user's "UI animations" toggle
// is meant for the operator's chrome only and must never gate slide
// transitions on the audience output. Each Wails webview is its own JS
// context but they share localStorage, so without this guard turning the
// toggle off in settings would silently kill every audience fade too.
function isOutputWindow(): boolean {
  if (typeof window === "undefined") return false
  return window.location.pathname.startsWith("/output/")
}

// Apply the stored preference synchronously at module load so motion's very
// first animation already respects it. MotionGlobalConfig.skipAnimations is
// read at animation time, so flipping it after mount also works — this is
// just to avoid a one-frame flash on initial render. Output windows skip
// this entirely — see isOutputWindow() above.
if (typeof window !== "undefined" && !isOutputWindow()) {
  const initial = readStored()
  MotionGlobalConfig.skipAnimations = !initial
  if (!initial) document.documentElement.setAttribute("data-no-anim", "")
}

type AnimationsState = {
  enabled: boolean
  setEnabled: (v: boolean) => void
}

const AnimationsContext = createContext<AnimationsState>({
  enabled: true,
  setEnabled: () => {},
})

// AnimationsProvider exposes a single global toggle for UI motion. When
// disabled it (a) flips motion's MotionGlobalConfig.skipAnimations so every
// motion component completes animations instantly regardless of any local
// transition override, and (b) sets `data-no-anim` on <html> so the CSS
// rule in App.css zeroes out plain CSS transitions/animations. Output
// windows ignore the toggle entirely — audience transitions always run.
export function AnimationsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(readStored)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (isOutputWindow()) {
      // Defensive: if this window was previously misconfigured, make
      // sure animations are on regardless of what's in localStorage.
      MotionGlobalConfig.skipAnimations = false
      document.documentElement.removeAttribute("data-no-anim")
      return
    }
    window.localStorage.setItem(STORAGE_KEY, String(enabled))
    MotionGlobalConfig.skipAnimations = !enabled
    if (enabled) document.documentElement.removeAttribute("data-no-anim")
    else document.documentElement.setAttribute("data-no-anim", "")
  }, [enabled])

  return (
    <AnimationsContext.Provider
      value={{ enabled, setEnabled: setEnabledState }}
    >
      {children}
    </AnimationsContext.Provider>
  )
}

export function useAnimations() {
  return useContext(AnimationsContext)
}
