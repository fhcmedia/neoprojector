import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import { BibleRef } from "@/bindings/neoprojector/services/schedule"
import { useUpdateBibleItem } from "@/features/schedule/api"

// BibleEditTarget identifies the schedule row being edited in the Bible
// drawer and carries its TENTATIVE reference. `book` is the canonical
// name used for verse queries and the UpdateBibleItem ref; `bookLabel`
// is the KJV display string for the chip. The verse range follows the
// operator's picks (via setRange) and is only persisted on commit —
// book and chapter never change (editing is verse-selection only).
export type BibleEditTarget = {
  itemId: number
  book: string
  bookLabel: string
  chapter: number
  verseStart: number
  verseEnd: number
}

type Ctx = {
  target: BibleEditTarget | null
  // parkAt carries the location an edit ended at — set on BOTH commit and
  // cancel — so the drawer simply stays put where it was editing rather
  // than jumping back to a prior position (which might be the Genesis
  // default, or worse, an earlier edit). A fresh object each time;
  // consumers de-dupe by reference.
  parkAt: BibleEditTarget | null
  begin: (t: BibleEditTarget) => void
  // setRange updates the tentative verse range (drawer highlight, chip,
  // and Show-pane preview follow it). No write to the schedule yet.
  setRange: (verseStart: number, verseEnd: number) => void
  // commit persists the tentative range and ends the edit. cancel ends
  // the edit without persisting (the row is untouched).
  commit: () => void
  cancel: () => void
}

const BibleEditContext = createContext<Ctx>({
  target: null,
  parkAt: null,
  begin: () => {},
  setRange: () => {},
  commit: () => {},
  cancel: () => {},
})

// BibleEditProvider holds the transient "editing a bible row in the
// drawer" state. Deliberately in-memory (not session-persisted) — an
// edit mode shouldn't survive an app reload. Scoped to the projector
// index, so navigating away (template editor, settings) drops it.
export function BibleEditProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { mutate: updateBibleItem } = useUpdateBibleItem()
  const [target, setTarget] = useState<BibleEditTarget | null>(null)
  const [parkAt, setParkAt] = useState<BibleEditTarget | null>(null)

  // Mirror target into a ref so the global key handler always reads the
  // live value (commit/cancel stay referentially stable and can never
  // act on a stale target).
  const targetRef = useRef<BibleEditTarget | null>(target)
  targetRef.current = target

  const begin = useCallback((t: BibleEditTarget) => setTarget(t), [])

  const setRange = useCallback(
    (verseStart: number, verseEnd: number) =>
      setTarget((prev) => (prev ? { ...prev, verseStart, verseEnd } : prev)),
    []
  )

  // Cancel discards the tentative range (the row is untouched) but parks
  // the drawer where it was editing — no jumping back to a prior spot.
  const cancel = useCallback(() => {
    const cur = targetRef.current
    if (cur) setParkAt(cur)
    setTarget(null)
  }, [])

  // On commit, write the new range into every cached schedule-items
  // family that holds the row so the label + Show-pane preview reflect
  // it instantly; the backend persist + refetch reconcile to the same
  // value. parkAt then keeps the drawer on the verse just edited.
  const commit = useCallback(() => {
    const cur = targetRef.current
    if (!cur) return
    const all = qc.getQueriesData<ListServiceItemsWithContentRow[]>({
      queryKey: ["schedule", "items"],
    })
    for (const [key, data] of all) {
      if (!data || !data.some((i) => i.id === cur.itemId)) continue
      qc.setQueryData(
        key,
        data.map((i) =>
          i.id === cur.itemId
            ? { ...i, verse_start: cur.verseStart, verse_end: cur.verseEnd }
            : i
        )
      )
    }
    updateBibleItem({
      itemId: cur.itemId,
      ref: new BibleRef({
        book: cur.book,
        chapter: cur.chapter,
        verse_start: cur.verseStart,
        verse_end: cur.verseEnd,
      }),
    })
    setParkAt(cur)
    setTarget(null)
  }, [qc, updateBibleItem])

  // Enter commits, Esc cancels. Runs in the capture phase and stops the
  // event so neither the global keybind (Esc → clear live output) nor
  // the focused verse button's own Enter activation also fires — while
  // armed, Enter/Esc mean confirm/cancel, nothing else. Only intercepts
  // when armed and the operator isn't typing in a field.
  useEffect(() => {
    if (!target) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Enter" && e.key !== "Escape") return
      const t = e.target as HTMLElement | null
      const editable =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      if (editable) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === "Enter") commit()
      else cancel()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [target, commit, cancel])

  return (
    <BibleEditContext.Provider
      value={{ target, parkAt, begin, setRange, commit, cancel }}
    >
      {children}
    </BibleEditContext.Provider>
  )
}

export function useBibleEdit() {
  return useContext(BibleEditContext)
}
