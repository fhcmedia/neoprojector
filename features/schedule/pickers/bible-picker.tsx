import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { motion } from "motion/react"
import { ChevronLeftIcon, SearchIcon } from "lucide-react"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import { ChapterVerse } from "@/bindings/neoprojector/services/bible"
import { BibleRef } from "@/bindings/neoprojector/services/schedule"
import type { BibleBook } from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"
import { Button } from "@/components/button"
import { useDebounce } from "@/hooks/use-debounce"
import { cn } from "@/lib/utils"
import { useAddBibleItem, useUpdateBibleItem } from "@/features/schedule/api"
import { parseBibleRef } from "@/features/schedule/bible-ref"
import {
  pickerContainerVariants,
  pickerRowVariants,
} from "@/features/schedule/picker-anim"

type Sel = { book: string; chapter: number; from: number; to: number }
type Step = "books" | "chapters" | "verses"

type Props =
  | { mode: "add"; sectionId: number; onSaved: () => void }
  | { mode: "edit"; itemId: number; initial: Sel; onSaved: () => void }

// Stable color per book category — left edge bar in the book list.
const categoryColors: Record<string, string> = {
  law: "bg-amber-500",
  history: "bg-emerald-500",
  poetry: "bg-sky-500",
  major_prophets: "bg-violet-500",
  minor_prophets: "bg-purple-500",
  gospels: "bg-rose-500",
  letters: "bg-orange-500",
  prophecy: "bg-pink-500",
}

// Narrow-column drill-down: search at top, three views (books → chapters →
// verses) sliding horizontally as the user drills in. Each step takes the
// full panel width.
export function BiblePicker(props: Props) {
  const { data: books } = useQuery({
    queryKey: ["bible", "books"],
    queryFn: () => Bible.ListBooks() as unknown as Promise<BibleBook[]>,
  })
  const addMut = useAddBibleItem(props.mode === "add" ? props.sectionId : 0)
  const updateMut = useUpdateBibleItem()

  const [sel, setSel] = useState<Sel | null>(
    props.mode === "edit" ? props.initial : null
  )
  const [step, setStep] = useState<Step>(
    props.mode === "edit" ? "verses" : "books"
  )
  const [search, setSearch] = useState("")
  const debounced = useDebounce(search, 200)

  // Tracks the parse "level" of the previously-resolved input so we only
  // auto-complete the search text when the user *advances* (typed more,
  // changed book, added chapter/verse). Backspacing within a recognized
  // book leaves the search bar alone — otherwise the autocomplete fights
  // the user trying to edit.
  const lastLevelRef = useRef(0)
  const lastBookRef = useRef("")

  function applyParse(input: string, advance: boolean): Sel | null {
    if (!books || !input.trim()) return null
    const parsed = parseBibleRef(input, books)
    if (!parsed) return null
    const sameBook = sel?.book === parsed.book
    const fallback: Sel =
      sameBook && sel
        ? sel
        : { book: parsed.book, chapter: 1, from: 1, to: 1 }
    const verseStart = parsed.verseStart ?? fallback.from
    const next: Sel = {
      book: parsed.book,
      chapter: parsed.chapter ?? fallback.chapter,
      from: verseStart,
      to: parsed.verseEnd ?? parsed.verseStart ?? fallback.to,
    }
    setSel(next)
    if (advance) {
      // Drill to whichever step the parse resolved.
      if (parsed.verseStart) setStep("verses")
      else if (parsed.chapter) setStep("verses")
      else setStep("chapters")
    }
    return next
  }

  useEffect(() => {
    if (!books) return
    if (!debounced.trim()) {
      lastLevelRef.current = 0
      lastBookRef.current = ""
      return
    }

    const parsed = parseBibleRef(debounced, books)
    if (!parsed) {
      lastLevelRef.current = 0
      return
    }

    applyParse(debounced, true)

    // Auto-complete the search bar. Build canonical form and replace the
    // typed text — but only when the parse advances (new book, or new
    // chapter/verse on the same book). This lets the user backspace past
    // an autocompleted name without it springing back.
    const level = parsed.verseStart ? 3 : parsed.chapter ? 2 : 1
    const advanced =
      parsed.book !== lastBookRef.current || level > lastLevelRef.current
    lastBookRef.current = parsed.book
    lastLevelRef.current = level

    if (!advanced) return

    const bookLabel =
      books.find((b) => b.name === parsed.book)?.name_kjv ?? parsed.book
    const canonical = formatRef(
      bookLabel,
      parsed.chapter,
      parsed.verseStart,
      parsed.verseEnd
    )
    if (canonical !== debounced) setSearch(canonical)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, books])

  function submit(target?: Sel | null) {
    const s = target ?? sel
    if (!s) return
    const ref = new BibleRef({
      book: s.book,
      chapter: s.chapter,
      verse_start: s.from,
      verse_end: s.to,
    })
    if (props.mode === "edit") {
      updateMut.mutate(
        { itemId: props.itemId, ref },
        { onSuccess: props.onSaved }
      )
      return
    }
    addMut.mutate(ref, { onSuccess: props.onSaved })
  }

  // Pull the active chapter's verses up here so we know the chapter's max
  // verse number — used to clamp a typed range like "Gen 1:45-100" down to
  // 31 and to drive the muted hint below the verse view.
  const { data: chapterVerses } = useQuery({
    queryKey: ["bible", "verses", sel?.book, sel?.chapter],
    queryFn: () =>
      Bible.ListVerses(sel!.book, sel!.chapter) as unknown as Promise<
        ChapterVerse[]
      >,
    enabled: !!sel?.book && !!sel?.chapter,
  })
  const maxVerse = chapterVerses?.length ?? 0
  const [clampNotice, setClampNotice] = useState(false)

  // Clamp the verse range to the chapter's actual length once verses load
  // for the active chapter. Fires after applyParse so a user pasting an
  // out-of-range ref gets pulled into bounds silently.
  useEffect(() => {
    if (!sel || maxVerse === 0) return
    if (sel.from <= maxVerse && sel.to <= maxVerse) return
    const from = Math.min(sel.from, maxVerse)
    const to = Math.min(sel.to, maxVerse)
    setSel({ ...sel, from, to })
    setClampNotice(true)
  }, [sel?.book, sel?.chapter, maxVerse]) // eslint-disable-line react-hooks/exhaustive-deps

  // Drop the clamp notice when the user moves to a different chapter.
  useEffect(() => {
    setClampNotice(false)
  }, [sel?.book, sel?.chapter])

  const stepIndex =
    step === "books" ? 0 : step === "chapters" ? 1 : 2
  const selectedBook = books?.find((b) => b.name === sel?.book)
  const selectionLabel =
    sel && selectedBook
      ? `${selectedBook.name_kjv} ${sel.chapter}:${
          sel.from === sel.to ? sel.from : `${sel.from}–${sel.to}`
        }`
      : ""
  const placeholder =
    selectionLabel || "Search for a specific verse or several"

  return (
    <motion.div
      className="flex h-full flex-col gap-2"
      variants={pickerContainerVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
    >
      <motion.div variants={pickerRowVariants} className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const forced = search.trim()
                ? applyParse(search, true)
                : null
              submit(forced ?? sel)
            }
          }}
          placeholder={placeholder}
          className="h-8 pl-8 text-xs placeholder:text-muted-foreground/40"
        />
      </motion.div>

      <motion.div variants={pickerRowVariants}>
        <Breadcrumb
          step={step}
          book={selectedBook}
          chapter={sel?.chapter}
          onGoTo={(s) => setStep(s)}
        />
      </motion.div>

      <motion.div
        variants={pickerRowVariants}
        className="relative flex-1 overflow-hidden rounded-md border border-border/50"
      >
        <div
          className="flex h-full w-[300%] transition-transform duration-200 ease-out"
          style={{ transform: `translateX(-${stepIndex * (100 / 3)}%)` }}
        >
          <div className="h-full w-1/3 shrink-0 overflow-hidden">
            <BooksView
              books={books ?? []}
              activeBook={sel?.book}
              onPick={(name) => {
                setSel({ book: name, chapter: 1, from: 1, to: 1 })
                setStep("chapters")
              }}
            />
          </div>
          <div className="h-full w-1/3 shrink-0 overflow-hidden">
            <ChaptersView
              book={sel?.book}
              activeChapter={sel?.chapter}
              onPick={(chapter) => {
                if (!sel) return
                setSel({ ...sel, chapter, from: 1, to: 1 })
                setStep("verses")
              }}
            />
          </div>
          <div className="h-full w-1/3 shrink-0 overflow-hidden">
            <VersesView
              book={sel?.book}
              chapter={sel?.chapter}
              from={sel?.from}
              to={sel?.to}
              onPick={(verse, extend) => {
                if (!sel) return
                if (extend && sel.from) {
                  const lo = Math.min(sel.from, sel.to, verse)
                  const hi = Math.max(sel.from, sel.to, verse)
                  setSel({ ...sel, from: lo, to: hi })
                } else {
                  setSel({ ...sel, from: verse, to: verse })
                }
              }}
            />
          </div>
        </div>
      </motion.div>

      {step === "verses" && sel && maxVerse > 0 && (
        <motion.div
          variants={pickerRowVariants}
          className="text-[10px] text-muted-foreground/60"
        >
          {clampNotice
            ? `Chapter has ${maxVerse} verse${maxVerse === 1 ? "" : "s"} — range trimmed`
            : `Chapter has ${maxVerse} verse${maxVerse === 1 ? "" : "s"}`}
        </motion.div>
      )}

      <motion.div variants={pickerRowVariants}>
        <Button
          onClick={() => submit()}
          disabled={!sel || addMut.isPending || updateMut.isPending}
          size="sm"
          className="w-full"
        >
          {props.mode === "edit" ? "Save" : "Add"}
        </Button>
      </motion.div>
    </motion.div>
  )
}

function Breadcrumb({
  step,
  book,
  chapter,
  onGoTo,
}: {
  step: Step
  book: BibleBook | undefined
  chapter: number | undefined
  onGoTo: (s: Step) => void
}) {
  if (step === "books") {
    return (
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
        Books
      </div>
    )
  }
  if (step === "chapters") {
    return (
      <div className="flex items-center gap-1 text-[11px]">
        <button
          type="button"
          onClick={() => onGoTo("books")}
          className="flex items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <ChevronLeftIcon className="size-3" />
          Books
        </button>
        <span className="text-muted-foreground/40">/</span>
        <span className="truncate text-foreground">{book?.name_kjv}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1 text-[11px]">
      <button
        type="button"
        onClick={() => onGoTo("books")}
        className="rounded px-1 py-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        {book?.name_kjv}
      </button>
      <span className="text-muted-foreground/40">/</span>
      <button
        type="button"
        onClick={() => onGoTo("chapters")}
        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <ChevronLeftIcon className="size-3" />
        Chapter {chapter}
      </button>
    </div>
  )
}

function BooksView({
  books,
  activeBook,
  onPick,
}: {
  books: BibleBook[]
  activeBook: string | undefined
  onPick: (book: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useAutoScrollTo(scrollRef, activeBook, `[data-book="${activeBook}"]`)

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto py-1">
      {books.map((b) => (
        <button
          key={b.name}
          type="button"
          data-book={b.name}
          onClick={() => onPick(b.name)}
          className={cn(
            "relative flex w-full items-center gap-2 py-1 pl-3 pr-2 text-left text-sm",
            activeBook === b.name
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <span
            className={cn(
              "absolute left-0 top-0 h-full w-0.5",
              categoryColors[b.category] ?? "bg-muted-foreground/30"
            )}
          />
          {b.name_kjv}
        </button>
      ))}
    </div>
  )
}

function ChaptersView({
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
    `[data-chapter="${activeChapter}"]`
  )

  if (!book) {
    return (
      <div className="grid h-full place-items-center text-[10px] text-muted-foreground/50">
        Pick a book
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-2">
      <div className="grid grid-cols-5 gap-1">
        {(chapters ?? []).map((c) => (
          <button
            key={c}
            type="button"
            data-chapter={c}
            onClick={() => onPick(c)}
            className={cn(
              "rounded px-1 py-1.5 text-center text-xs tabular-nums",
              activeChapter === c
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}

function VersesView({
  book,
  chapter,
  from,
  to,
  onPick,
}: {
  book: string | undefined
  chapter: number | undefined
  from: number | undefined
  to: number | undefined
  onPick: (verse: number, extend: boolean) => void
}) {
  const { data: verses } = useQuery({
    queryKey: ["bible", "verses", book, chapter],
    queryFn: () =>
      Bible.ListVerses(book!, chapter!) as unknown as Promise<
        ChapterVerse[]
      >,
    enabled: !!book && !!chapter,
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  useAutoScrollTo(
    scrollRef,
    `${book}-${chapter}-${from}`,
    `[data-verse="${from}"]`
  )

  if (!book || !chapter) {
    return (
      <div className="grid h-full place-items-center text-[10px] text-muted-foreground/50">
        Pick a chapter
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto py-1">
      {(verses ?? []).map((v) => {
        const inRange =
          from !== undefined &&
          to !== undefined &&
          v.verse >= Math.min(from, to) &&
          v.verse <= Math.max(from, to)
        return (
          <button
            key={v.verse}
            type="button"
            data-verse={v.verse}
            onClick={(e) => onPick(v.verse, e.shiftKey)}
            className={cn(
              "flex w-full gap-2 px-3 py-1.5 text-left text-xs leading-snug",
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

// Pure helper: useAutoScrollTo scrolls a container so the selected element
// lands centered.
function useAutoScrollTo(
  containerRef: React.RefObject<HTMLDivElement | null>,
  dep: unknown,
  selector: string
) {
  useEffect(() => {
    const c = containerRef.current
    if (!c || dep === undefined || dep === null) return
    const el = c.querySelector<HTMLElement>(selector)
    if (!el) return
    const top = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2
    c.scrollTo({ top, behavior: "smooth" })
  }, [containerRef, dep, selector])
}

// formatRef renders the canonical display form for a parsed reference. Used
// by the search-bar autocomplete to replace what the user typed with the
// resolved reference (e.g. "gen 3:16" → "Genesis 3:16").
function formatRef(
  book: string,
  chapter?: number,
  verseStart?: number,
  verseEnd?: number
): string {
  let s = book
  if (chapter) s += ` ${chapter}`
  if (verseStart) {
    s += `:${verseStart}`
    if (verseEnd && verseEnd !== verseStart) s += `-${verseEnd}`
  }
  return s
}

// Defensive use of useMemo to avoid a TS-only "unused import" complaint when
// reordering helpers. Tree-shaken in build.
void useMemo
