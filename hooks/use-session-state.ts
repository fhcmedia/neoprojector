import { useEffect, useState } from "react"

// useSessionState is useState with a session-scoped JSON-serialized
// backing store. The state survives unmounts within a session (so a
// user who navigates away to the template editor and back returns to
// exactly the index state they left) but resets on app restart.
//
// Use this for ephemeral UI state where the user expects continuity —
// selected items, open tab, search strings — but where persistence
// across sessions would feel intrusive.
//
// Each call must pass a stable `key`. Don't compose the key from
// changing values; if you need per-entity scoping, store a map at a
// stable key and look up inside the consumer.
export function useSessionState<T>(
  key: string,
  initial: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial
    const stored = window.sessionStorage.getItem(key)
    if (stored === null) return initial
    try {
      return JSON.parse(stored) as T
    } catch {
      return initial
    }
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state))
    } catch {
      // Quota errors, private-mode restrictions — degrade silently.
    }
  }, [key, state])

  return [state, setState]
}
