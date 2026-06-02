import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

const STORAGE_KEY = "neoprojector.libraryAutoCollapse"

// Default ON — first run (no stored value) collapses by default.
function readStored(): boolean {
  if (typeof window === "undefined") return true
  const v = window.localStorage.getItem(STORAGE_KEY)
  return v === null ? true : v === "true"
}

type State = {
  enabled: boolean
  setEnabled: (v: boolean) => void
}

const Ctx = createContext<State>({ enabled: true, setEnabled: () => {} })

// LibraryAutoCollapseProvider gates the "slide the library drawer down
// to just its tabs when it's redundant with the show pane" behaviour.
// Currently only bible triggers the collapse (the bible drawer and the
// show pane's bible view show the same thing). Persisted to localStorage.
export function LibraryAutoCollapseProvider({
  children,
}: {
  children: ReactNode
}) {
  const [enabled, setEnabledState] = useState<boolean>(readStored)

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, String(enabled))
  }, [enabled])

  return (
    <Ctx.Provider value={{ enabled, setEnabled: setEnabledState }}>
      {children}
    </Ctx.Provider>
  )
}

export function useLibraryAutoCollapse() {
  return useContext(Ctx)
}
