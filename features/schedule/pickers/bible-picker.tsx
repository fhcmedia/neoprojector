import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { SearchIcon } from "lucide-react"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import { ChapterVerse } from "@/bindings/neoprojector/services/bible"
import { BibleRef } from "@/bindings/neoprojector/services/schedule"
import type { BibleBook } from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"
import { Button } from "@/components/button"
import { useDebounce } from "@/hooks/use-debounce"
import { cn } from "@/lib/utils"
import { useAddBibleItem, useUpdateBibleItem } from "../api"
import { parseBibleRef } from "../bible-ref"

type Sel = { book: string; chapter: number; from: number; to: number }

type Props =
  | {
      mode: "add"
      sectionId: number
      onSaved: () => void
    }
  | {
      mode: "edit"
      itemId: number
      initial: Sel
      onSaved: () => void
    }

// Stable color per book category. Left bar in the book list.
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
  const [search, setSearch] = useState("")
  const debounced = useDebounce(search, 200)

  function applyParse(input: string): Sel | null {
    if (!books || !input.trim()) return null
    const parsed = parseBibleRef(input, books)
    if (!parsed) return null
    // When the book hasn't changed, missing chapter/verses inherit the
    // previous selection so partial typing ("Gen 2:") doesn't blow away
    // the verse range the user already had picked.
    const sameBook = sel?.book === parsed.book
    const fallback: Sel = sameBook && sel ? sel : { book: parsed.book, chapter: 1, from: 1, to: 1 }
    const verseStart = parsed.verseStart ?? fallback.from
    const next: Sel = {
      book: parsed.book,
      chapter: parsed.chapter ?? fallback.chapter,
      from: verseStart,
      to: parsed.verseEnd ?? parsed.verseStart ?? fallback.to,
    }
    setSel(next)
    return next
  }

  // Drive selection from the search bar as the user types (debounced).
  useEffect(() => {
    applyParse(debounced)
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
    <div className="flex h-full flex-col gap-2 pt-2">
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Parse the current text immediately rather than waiting on debounce.
              const forced = search.trim() ? applyParse(search) : null
              submit(forced ?? sel)
            }
          }}
          placeholder={placeholder}
          className="h-9 pl-8 text-sm placeholder:text-muted-foreground/40"
          autoFocus
        />
      </div>

      <div className="grid flex-1 grid-cols-[14rem_5rem_1fr] gap-2 overflow-hidden rounded-md border border-border/50">
        <BookPane
          books={books ?? []}
          activeBook={sel?.book}
          onPick={(book) =>
            setSel({ book, chapter: 1, from: 1, to: 1 })
          }
        />
        <ChapterPane
          book={sel?.book}
          activeChapter={sel?.chapter}
          onPick={(chapter) =>
            sel && setSel({ ...sel, chapter, from: 1, to: 1 })
          }
        />
        <VersePane
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

      <div className="flex items-center justify-end pt-1">
        <Button
          onClick={() => submit()}
          disabled={!sel || addMut.isPending || updateMut.isPending}
          size="sm"
        >
          {props.mode === "edit" ? "Save" : "Add"}
        </Button>
      </div>
    </div>
  )
}

function BookPane({
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
    <div
      ref={scrollRef}
      className="overflow-y-auto border-r border-border/50 py-1"
    >
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

function ChapterPane({
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
  useAutoScrollTo(scrollRef, activeChapter, `[data-chapter="${activeChapter}"]`)

  if (!book) {
    return (
      <div className="grid place-items-center border-r border-border/50 text-[10px] text-muted-foreground/50">
        Book
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto border-r border-border/50 py-1"
    >
      {(chapters ?? []).map((c) => (
        <button
          key={c}
          type="button"
          data-chapter={c}
          onClick={() => onPick(c)}
          className={cn(
            "w-full px-2 py-1 text-center text-sm tabular-nums",
            activeChapter === c
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          {c}
        </button>
      ))}
    </div>
  )
}

function VersePane({
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
      Bible.ListVerses(book!, chapter!) as unknown as Promise<ChapterVerse[]>,
    enabled: !!book && !!chapter,
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  useAutoScrollTo(scrollRef, `${book}-${chapter}-${from}`, `[data-verse="${from}"]`)

  if (!book || !chapter) {
    return (
      <div className="grid place-items-center text-[10px] text-muted-foreground/50">
        Chapter
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="overflow-y-auto py-1">
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
              "flex w-full gap-2 px-3 py-1.5 text-left text-sm leading-snug",
              inRange
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
          >
            <span className="shrink-0 pt-px text-xs tabular-nums text-muted-foreground/70">
              {v.verse}
            </span>
            <span className="line-clamp-2">{v.text}</span>
          </button>
        )
      })}
    </div>
  )
}

// useAutoScrollTo scrolls the container so that the element matching selector
// is roughly centered when `dep` changes.
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
