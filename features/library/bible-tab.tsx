import { useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import type { BibleBook } from "@/bindings/neoprojector/database"
import type { ChapterVerse } from "@/bindings/neoprojector/services/bible"
import { useSessionState } from "@/hooks/use-session-state"
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

export function BibleTab({ search, onSubmit }: Props) {
  const { data: books } = useQuery({
    queryKey: ["bible", "books"],
    queryFn: () => Bible.ListBooks() as unknown as Promise<BibleBook[]>,
  })

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

  // Pane updates are immediate — chapter and verse should react on
  // every keystroke without waiting for a debounce settle. Only the
  // search input's autocomplete (which rewrites a typed prefix to a
  // canonical book name) is debounced, and that lives on the input.
  useEffect(() => {
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

  return (
    <div className="flex h-full">
      <BooksPane
        books={books ?? []}
        activeBook={book}
        onPick={(b) => {
          setBook(b)
          setChapter(undefined)
          setVerseStart(undefined)
          setVerseEnd(undefined)
        }}
      />
      <ChaptersPane
        book={book}
        activeChapter={chapter}
        onPick={(c) => {
          setChapter(c)
          setVerseStart(undefined)
          setVerseEnd(undefined)
        }}
      />
      <VersesPane
        book={book}
        chapter={chapter}
        verseStart={verseStart}
        verseEnd={verseEnd}
        onPick={(verse, extend) => {
          // Compute the new range locally before persisting state —
          // we need it for the emit too, and useSessionState is
          // async so we can't rely on the post-set values.
          let nextStart = verse
          let nextEnd = verse
          if (extend && verseStart !== undefined) {
            nextStart = Math.min(verseStart, verse)
            nextEnd = Math.max(verseEnd ?? verseStart, verse)
          }
          setVerseStart(nextStart)
          setVerseEnd(nextEnd)
          if (book && chapter !== undefined) {
            const bookLabel =
              books?.find((b) => b.name === book)?.name_kjv ?? book
            onSubmit?.({
              book,
              bookLabel,
              chapter,
              verseStart: nextStart,
              verseEnd: nextEnd,
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
}: {
  books: BibleBook[]
  activeBook: string | undefined
  onPick: (name: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useAutoScrollTo(scrollRef, activeBook, `[data-book="${activeBook}"]`, books)

  return (
    <div
      ref={scrollRef}
      className="w-[220px] shrink-0 overflow-y-auto border-r border-border/40 py-1"
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
}: {
  book: string | undefined
  activeChapter: number | undefined
  onPick: (chapter: number) => void
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
      className="w-[180px] shrink-0 overflow-y-auto border-r border-border/40 p-2"
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

