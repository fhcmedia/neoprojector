import { createContext, useCallback, useContext, useEffect, useState } from "react"

type PlayedState = {
  played: Set<number>
  toggle: (id: number) => void
  isPlayed: (id: number) => boolean
}

const PlayedContext = createContext<PlayedState | null>(null)

// Tracks which items have been marked as played, per service. Kept in
// this computer's localStorage (not the DB — it's the operator's running
// checklist, not service content), so checkmarks survive an app restart
// and switching between services.
const keyFor = (serviceId: number) => `neoprojector.played.${serviceId}`

export function loadPlayed(serviceId: number): Set<number> {
  try {
    const raw = window.localStorage.getItem(keyFor(serviceId))
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(ids) ? ids.filter((n): n is number => typeof n === "number") : [])
  } catch {
    return new Set()
  }
}

function savePlayed(serviceId: number, played: Set<number>) {
  try {
    if (played.size === 0) window.localStorage.removeItem(keyFor(serviceId))
    else window.localStorage.setItem(keyFor(serviceId), JSON.stringify([...played]))
  } catch {
    // Storage unavailable: checkmarks just won't persist.
  }
}

export function PlayedProvider({
  serviceId,
  children,
}: {
  serviceId: number
  children: React.ReactNode
}) {
  const [played, setPlayed] = useState<Set<number>>(() => loadPlayed(serviceId))

  // Switching services shows that service's own checkmarks.
  useEffect(() => {
    setPlayed(loadPlayed(serviceId))
  }, [serviceId])

  const toggle = useCallback(
    (id: number) => {
      setPlayed((p) => {
        const next = new Set(p)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        savePlayed(serviceId, next)
        return next
      })
    },
    [serviceId]
  )

  const isPlayed = useCallback((id: number) => played.has(id), [played])

  return (
    <PlayedContext.Provider value={{ played, toggle, isPlayed }}>
      {children}
    </PlayedContext.Provider>
  )
}

export function usePlayed() {
  const ctx = useContext(PlayedContext)
  if (!ctx) throw new Error("usePlayed must be used inside <PlayedProvider>")
  return ctx
}
