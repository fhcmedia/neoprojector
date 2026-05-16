import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

const STORAGE_KEY = "neoprojector.bibleTranslations"

// Default primary = KJV. Secondary/tertiary stay unset until the user
// explicitly opts in via Settings > Bibles. This matches the bible
// templates: "One Translation" fills primary only; "Two Translations"
// fills primary + secondary; "Three Translations" fills all three.
export type BibleTranslations = {
  primary: string
  secondary: string | null
  tertiary: string | null
}

const DEFAULT_STATE: BibleTranslations = {
  primary: "KJV",
  secondary: null,
  tertiary: null,
}

function readStored(): BibleTranslations {
  if (typeof window === "undefined") return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_STATE, ...parsed }
  } catch {
    return DEFAULT_STATE
  }
}

type Ctx = {
  state: BibleTranslations
  setPrimary: (t: string) => void
  setSecondary: (t: string | null) => void
  setTertiary: (t: string | null) => void
}

const BibleTranslationsContext = createContext<Ctx>({
  state: DEFAULT_STATE,
  setPrimary: () => {},
  setSecondary: () => {},
  setTertiary: () => {},
})

export function BibleTranslationsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BibleTranslations>(readStored)

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  return (
    <BibleTranslationsContext.Provider
      value={{
        state,
        setPrimary: (t) => setState((s) => ({ ...s, primary: t })),
        setSecondary: (t) => setState((s) => ({ ...s, secondary: t })),
        setTertiary: (t) => setState((s) => ({ ...s, tertiary: t })),
      }}
    >
      {children}
    </BibleTranslationsContext.Provider>
  )
}

export function useBibleTranslations() {
  return useContext(BibleTranslationsContext)
}
