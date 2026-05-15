import { createContext, useCallback, useContext, useEffect, useState } from "react"

type PlayedState = {
  played: Set<number>
  toggle: (id: number) => void
  isPlayed: (id: number) => boolean
}

const PlayedContext = createContext<PlayedState | null>(null)

// Tracks which items have been marked as played for the active service.
// Local-only — never written to the DB. Resets whenever the active service
// changes (driven by the `serviceId` key).
export function PlayedProvider({
  serviceId,
  children,
}: {
  serviceId: number
  children: React.ReactNode
}) {
  const [played, setPlayed] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    setPlayed(new Set())
  }, [serviceId])

  const toggle = useCallback((id: number) => {
    setPlayed((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

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
