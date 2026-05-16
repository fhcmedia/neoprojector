import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

const STORAGE_KEY = "neoprojector.vimMode"

function readStored(): boolean {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(STORAGE_KEY) === "true"
}

type VimModeState = {
  enabled: boolean
  setEnabled: (v: boolean) => void
}

const VimModeContext = createContext<VimModeState>({
  enabled: false,
  setEnabled: () => {},
})

// VimModeProvider exposes a single toggle for vim-style navigation
// keys (j/k/h/l). Arrow keys always work regardless; vim mode just
// adds the extra bindings for operators who never want to leave the
// home row. Persisted to localStorage — survives restarts.
export function VimModeProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(readStored)

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, String(enabled))
  }, [enabled])

  return (
    <VimModeContext.Provider value={{ enabled, setEnabled: setEnabledState }}>
      {children}
    </VimModeContext.Provider>
  )
}

export function useVimMode() {
  return useContext(VimModeContext)
}
