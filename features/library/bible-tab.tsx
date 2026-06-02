import { useEffect, useLayoutEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import type { BibleBook } from "@/bindings/neoprojector/database"
import type { ChapterVerse } from "@/bindings/neoprojector/services/bible"
import { useSessionState } from "@/hooks/use-session-state"
import { useBibleEdit } from "@/features/schedule/bible-edit-context"
import { useLive } from "@/features/live/live-context"
import { parseBibleRef } from "@/features/schedule/bible-ref"
import { bibleCategoryBorderClass } from "@/features/bible/categories"
import type { AdHocBibleRef } from "@/features/show/show-pane"
import { cn } from "@/lib/utils"

type Props = {
  search: string
  // Pick a verse → emit the resulting range so the projector
  // populates the show pane and auto-broadcasts the first slide.
  // Same flow as typing-and-Enter in the search bar.
  onSubmit?: (ref: AdHocBibleRef) => void
}

// Resolve the next verse range when a verse is picked. A plain click on
// the contiguous next verse (end + 1) GROWS the range, and a click
// inside the current range keeps it (just re-targets which verse is
// live) — so the operator builds a passage by clicking down the chapter
// and each pick adds to the Show-pane list. A jump (gap, or above the
// start) restarts a fresh single-verse selection. Shift-click always
// spans min..max.
function nextVerseRange(
  start: number | undefined,
  end: number | undefined,
  verse: number,
  extend: boolean
): [number, number] {
  if (extend && start !== undefined) {
    return [Math.min(start, verse), Math.max(end ?? start, verse)]
  }
  if (start === undefined || end === undefined) return [verse, verse]
  if (verse >= start && verse <= end) return [start, end]
  if (verse === end + 1) return [start, verse]
  return [verse, verse]
}

export function BibleTab({ search, onSubmit }: Props) {
  const { data: books } = useQuery({
    queryKey: ["bible", "books"],
    queryFn: () => Bible.ListBooks() as unknown as Promise<BibleBook[]>,
  })

  // When a schedule row is being edited, the drawer is "armed": book and
  // chapter are pinned to the row (edit is verse-selection only) and a
  // verse pick updates the tentative range via `setRange` — which the
  // drawer highlight, the header chip, and the Show-pane preview all
  // follow. Nothing persists until the operator confirms (Enter).
  const { target, setRange, parkAt } = useBibleEdit()
  const armed = target !== null

  // Selection state — session-persisted so the operator lands back
  // exactly where they were across navigations within the session.
  // First-ever open seeds Genesis 1:1 so the panes have something
  // to render instead of three "pick a …" stub panels.
  const [book, setBook] = useSessionState<string | undefined>(
    "neoprojector.bibleBook",
    "Genesis"
  )
  const [chapter, setChapter] = useSessionState<number | undefined>(
    "neoprojector.bibleChapter",
    1
  )
  const [verseStart, setVerseStart] = useSessionState<number | undefined>(
    "neoprojector.bibleVerseStart",
    1
  )
  const [verseEnd, setVerseEnd] = useSessionState<number | undefined>(
    "neoprojector.bibleVerseEnd",
    1
  )

  // Follow live: when the operator navigates bible from the show pane,
  // move the drawer's highlight to the live verse so the two stay in
  // sync. We only jump when the live verse lands OUTSIDE the drawer's
  // current selection — a verse already within range came from the
  // drawer (or is already covered), so we leave the selection intact
  // (preserves an accumulated/shift-selected range). Editing (armed)
  // owns the selection, so skip then.
  const { live } = useLive()
  const liveBible = live?.kind === "bible" ? live.bibleRef : undefined
  useEffect(() => {
    if (armed || !liveBible) return
    const covered =
      liveBible.book === book &&
      liveBible.chapter === chapter &&
      verseStart !== undefined &&
      verseEnd !== undefined &&
      liveBible.verse >= verseStart &&
      liveBible.verse <= verseEnd
    if (covered) return
    setBook(liveBible.book)
    setChapter(liveBible.chapter)
    setVerseStart(liveBible.verse)
    setVerseEnd(liveBible.verse)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBible?.book, liveBible?.chapter, liveBible?.verse, armed])

  // When an edit ends (commit OR cancel), park the browse position right
  // where the edit was, so the drawer simply stays put — it never jumps
  // back to a prior spot (Genesis default, or an earlier edit). The edit
  // already drove the view here via the override, so this just persists
  // it into the browse state. useLayoutEffect runs before paint so the
  // hand-off is seamless (no flash). De-duped by reference.
  const lastParkRef = useRef(parkAt)
  useLayoutEffect(() => {
    if (!parkAt || parkAt === lastParkRef.current) return
    lastParkRef.current = parkAt
    setBook(parkAt.book)
    setChapter(parkAt.chapter)
    setVerseStart(parkAt.verseStart)
    setVerseEnd(parkAt.verseEnd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkAt])

  // Pane updates are immediate — chapter and verse should react on
  // every keystroke without waiting for a debounce settle. Only the
  // search input's autocomplete (which rewrites a typed prefix to a
  // canonical book name) is debounced, and that lives on the input.
  useEffect(() => {
    // Armed mode owns book/chapter/verse from the edit target; the
    // search input is hidden behind the chip, so ignore search nav.
    if (target) return
    if (!books) return
    const text = search.trim()
    if (!text) return
    const parsed = parseBibleRef(text, books)
    if (!parsed) return
    setBook(parsed.book)
    if (parsed.chapter !== undefined) setChapter(parsed.chapter)
    else setChapter(undefined)
    if (parsed.verseStart !== undefined) {
      setVerseStart(parsed.verseStart)
      setVerseEnd(parsed.verseEnd ?? parsed.verseStart)
    } else {
      setVerseStart(undefined)
      setVerseEnd(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, books])

  // Effective selection: the edit target wins while armed, otherwise the
  // operator's own browse state drives the panes.
  const shownBook = armed ? target.book : book
  const shownChapter = armed ? target.chapter : chapter
  const shownStart = armed ? target.verseStart : verseStart
  const shownEnd = armed ? target.verseEnd : verseEnd

  return (
    <div className="flex h-full">
      <BooksPane
        books={books ?? []}
        activeBook={shownBook}
        locked={armed}
        onPick={(b) => {
          if (armed) return
          setBook(b)
          setChapter(undefined)
          setVerseStart(undefined)
          setVerseEnd(undefined)
        }}
      />
      <ChaptersPane
        book={shownBook}
        activeChapter={shownChapter}
        locked={armed}
        onPick={(c) => {
          if (armed) return
          setChapter(c)
          setVerseStart(undefined)
          setVerseEnd(undefined)
        }}
      />
      <VersesPane
        book={shownBook}
        chapter={shownChapter}
        verseStart={shownStart}
        verseEnd={shownEnd}
        onPick={(verse, extend) => {
          // Compute the new range locally first — we need it for both
          // the state update and the emit/mutation, and useSessionState
          // is async so the post-set values aren't readable here.
          if (target) {
            // Armed: update the tentative range only. The preview
            // follows; nothing persists and the projector output is
            // never touched until the operator confirms.
            const [nextStart, nextEnd] = nextVerseRange(
              target.verseStart,
              target.verseEnd,
              verse,
              extend
            )
            setRange(nextStart, nextEnd)
            return
          }
          // Ad-hoc browse: grow/keep the selection and push it live.
          const [nextStart, nextEnd] = nextVerseRange(
            verseStart,
            verseEnd,
            verse,
            extend
          )
          setVerseStart(nextStart)
          setVerseEnd(nextEnd)
          if (book && chapter !== undefined) {
            const bookLabel =
              books?.find((b) => b.name === book)?.name_kjv ?? book
            // liveVerse is the verse just clicked — it goes live even
            // when the range grew around it.
            onSubmit?.({
              book,
              bookLabel,
              chapter,
              verseStart: nextStart,
              verseEnd: nextEnd,
              liveVerse: verse,
            })
          }
        }}
      />
    </div>
  )
}

function BooksPane({
  books,
  activeBook,
  onPick,
  locked = false,
}: {
  books: BibleBook[]
  activeBook: string | undefined
  onPick: (name: string) => void
  // locked dims the pane and ignores clicks — book is fixed while
  // editing a schedule row.
  locked?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useAutoScrollTo(scrollRef, activeBook, `[data-book="${activeBook}"]`, books)

  return (
    <div
      ref={scrollRef}
      className={cn(
        "w-[220px] shrink-0 overflow-y-auto border-r border-border/40 py-1",
        locked && "pointer-events-none opacity-40"
      )}
    >
      {books.map((b) => {
        const border = bibleCategoryBorderClass(b.category)
        const isActive = activeBook === b.name
        return (
          <button
            key={b.name}
            type="button"
            data-book={b.name}
            onClick={() => onPick(b.name)}
            className={cn(
              "flex w-full items-center gap-2 border-l-2 py-1 pl-2.5 pr-2 text-left text-xs transition-colors",
              border,
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {b.name_kjv}
          </button>
        )
      })}
    </div>
  )
}

function ChaptersPane({
  book,
  activeChapter,
  onPick,
  locked = false,
}: {
  book: string | undefined
  activeChapter: number | undefined
  onPick: (chapter: number) => void
  // locked dims the pane and ignores clicks — chapter is fixed while
  // editing a schedule row.
  locked?: boolean
}) {
  const { data: chapters } = useQuery({
    queryKey: ["bible", "chapters", book],
    queryFn: () =>
      Bible.ListChapters(book!) as unknown as Promise<number[]>,
    enabled: !!book,
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  useAutoScrollTo(
    scrollRef,
    activeChapter,
    `[data-chapter="${activeChapter}"]`,
    chapters
  )

  if (!book) {
    return (
      <div className="grid w-[180px] shrink-0 place-items-center border-r border-border/40 text-[10px] text-muted-foreground/50">
        Pick a book
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        "w-[180px] shrink-0 overflow-y-auto border-r border-border/40 p-2",
        locked && "pointer-events-none opacity-40"
      )}
    >
      <div className="grid grid-cols-5 gap-1">
        {(chapters ?? []).map((c) => (
          <button
            key={c}
            type="button"
            data-chapter={c}
            onClick={() => onPick(c)}
            className={cn(
              "rounded px-1 py-1.5 text-center text-xs tabular-nums transition-colors",
              activeChapter === c
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            )}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}

function VersesPane({
  book,
  chapter,
  verseStart,
  verseEnd,
  onPick,
}: {
  book: string | undefined
  chapter: number | undefined
  verseStart: number | undefined
  verseEnd: number | undefined
  onPick: (verse: number, extend: boolean) => void
}) {
  const { data: verses } = useQuery({
    queryKey: ["bible", "verses", book, chapter],
    queryFn: () =>
      Bible.ListVerses(book!, chapter!) as unknown as Promise<ChapterVerse[]>,
    enabled: !!book && !!chapter,
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  useAutoScrollTo(
    scrollRef,
    verseStart !== undefined ? `${book}-${chapter}-${verseStart}` : undefined,
    `[data-verse="${verseStart}"]`,
    verses
  )

  // Clamp a user-typed out-of-range reference to the chapter's actual
  // verse count so the highlight doesn't point at nothing.
  const maxVerse = verses?.length ?? 0
  const lo = verseStart !== undefined ? Math.min(verseStart, maxVerse) : undefined
  const hi = verseEnd !== undefined ? Math.min(verseEnd, maxVerse) : lo

  if (!book || !chapter) {
    return (
      <div className="grid flex-1 place-items-center text-[10px] text-muted-foreground/50">
        Pick a chapter
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto py-1">
      {(verses ?? []).map((v) => {
        const inRange =
          lo !== undefined &&
          hi !== undefined &&
          v.verse >= lo &&
          v.verse <= hi
        return (
          <button
            key={v.verse}
            type="button"
            data-verse={v.verse}
            onClick={(e) => onPick(v.verse, e.shiftKey)}
            className={cn(
              "flex w-full gap-2 px-3 py-1.5 text-left text-xs leading-snug transition-colors",
              inRange
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <span className="shrink-0 pt-px text-[10px] tabular-nums text-muted-foreground/70">
              {v.verse}
            </span>
            <span className="line-clamp-3">{v.text}</span>
          </button>
        )
      })}
    </div>
  )
}

// Scrolls a container so the selected element lands centered. Used by
// each pane to keep the active selection visible when search navigates
// programmatically or the user jumps to a far chapter/verse.
//
// `data` lets the effect retrigger once an async query (chapters,
// verses) actually resolves — without it, the scroll fires before the
// matching DOM exists and silently bails. getBoundingClientRect makes
// the math correct regardless of whether the scroll container is the
// nearest positioned ancestor (it usually isn't, here).
function useAutoScrollTo(
  containerRef: React.RefObject<HTMLDivElement | null>,
  dep: unknown,
  selector: string,
  data?: unknown
) {
  useEffect(() => {
    const c = containerRef.current
    if (!c || dep === undefined || dep === null) return
    // rAF defers one frame so newly-rendered rows from a fresh query
    // are laid out before we measure them.
    const id = requestAnimationFrame(() => {
      const el = c.querySelector<HTMLElement>(selector)
      if (!el) return
      const containerRect = c.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const elTopInScroll = elRect.top - containerRect.top + c.scrollTop
      const target =
        elTopInScroll - c.clientHeight / 2 + el.clientHeight / 2
      c.scrollTo({ top: target, behavior: "smooth" })
    })
    return () => cancelAnimationFrame(id)
  }, [containerRef, dep, selector, data])
}

