import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { SearchIcon } from "lucide-react"
import { useSessionState } from "@/hooks/use-session-state"
import { useDebounce } from "@/hooks/use-debounce"
import { Dialogs, Events } from "@wailsio/runtime"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import type { BibleBook } from "@/bindings/neoprojector/database"
import type { AdHocBibleRef } from "@/features/show/show-pane"
import type { ChapterVerse } from "@/bindings/neoprojector/services/bible"
import { useLive } from "@/features/live/live-context"
import { useBibleTranslations } from "@/hooks/use-bible-translations"
import { Input } from "@/components/input"
import { cn } from "@/lib/utils"
import { BibleTab } from "@/features/library/bible-tab"
import { SongsTab } from "@/features/library/songs-tab"
import { MediaTab } from "@/features/library/media-tab"
import { TemplatesTab } from "@/features/library/templates-tab"
import { OverlaysTab } from "@/features/library/overlays-tab"
import { PresentationsTab } from "@/features/library/presentations-tab"
import { parseBibleRef } from "@/features/schedule/bible-ref"
import { formatBibleRef } from "@/features/bible/categories"

type Tab =
  | "bible"
  | "songs"
  | "media"
  | "presentations"
  | "templates"
  | "overlays"

const TABS: { key: Tab; label: string }[] = [
  { key: "bible", label: "Bible" },
  { key: "songs", label: "Songs" },
  { key: "media", label: "Media" },
  { key: "presentations", label: "Presentations" },
  { key: "templates", label: "Templates" },
  { key: "overlays", label: "Overlays" },
]

const MEDIA_DROP_EVENT = "media:files-dropped"
const MEDIA_DROP_TARGET = "library-media"

type MediaDropPayload = {
  paths?: string[]
  target_id?: string
}

type LibraryViewProps = {
  onAdHocBibleRef?: (ref: AdHocBibleRef) => void
  // Called when the operator clicks a media tile. Parent decides
  // what "click" means (typically: append to the auto-inbox + focus
  // the new schedule item so its preview shows in the show pane).
  onMediaPick?: (mediaId: number) => void
}

export function LibraryView({
  onAdHocBibleRef,
  onMediaPick,
}: LibraryViewProps = {}) {
  const navigate = useNavigate()
  // Library state is session-persisted: active tab + per-tab search
  // strings survive route changes (template editor and back) within
  // the same session, so the user lands exactly where they left.
  const [active, setActive] = useSessionState<Tab>(
    "neoprojector.libraryTab",
    "bible"
  )

  const [bibleSearch, setBibleSearch] = useSessionState<string>(
    "neoprojector.bibleSearch",
    ""
  )
  const [songSearch, setSongSearch] = useSessionState<string>(
    "neoprojector.songSearch",
    ""
  )
  const [mediaSearch, setMediaSearch] = useSessionState<string>(
    "neoprojector.mediaSearch",
    ""
  )
  const [templateSearch, setTemplateSearch] = useSessionState<string>(
    "neoprojector.templateSearch",
    ""
  )
  const [overlaySearch, setOverlaySearch] = useSessionState<string>(
    "neoprojector.overlaySearch",
    ""
  )
  const [presentationSearch, setPresentationSearch] = useSessionState<string>(
    "neoprojector.presentationSearch",
    ""
  )

  // Media import is also lifted so the "+" button can live in the
  // header. The drop-event handler stays here too — drops can land on
  // the library while any tab is active, so binding it at this level
  // avoids re-subscribing on tab swaps.
  const qc = useQueryClient()
  const [importing, setImporting] = useState(false)

  async function importPaths(paths: string[]) {
    if (paths.length === 0) return
    setImporting(true)
    try {
      await Media.ImportFiles(paths)
      qc.invalidateQueries({ queryKey: ["media", "list"] })
    } finally {
      setImporting(false)
    }
  }

  async function openMediaFileDialog() {
    const picked = await Dialogs.OpenFile({
      Title: "Add media",
      AllowsMultipleSelection: true,
      CanChooseFiles: true,
      CanChooseDirectories: false,
      Filters: [
        {
          DisplayName: "Media (images, videos, audio, PDF)",
          Pattern:
            "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.mp4;*.webm;*.mov;*.mp3;*.wav;*.ogg;*.pdf",
        },
        { DisplayName: "All files", Pattern: "*.*" },
      ],
    })
    const paths = Array.isArray(picked)
      ? picked
      : typeof picked === "string" && picked
        ? [picked]
        : []
    await importPaths(paths)
  }

  useEffect(() => {
    const off = Events.On(
      MEDIA_DROP_EVENT,
      (event: { data?: MediaDropPayload }) => {
        const data = event?.data ?? {}
        if (data.target_id !== MEDIA_DROP_TARGET) return
        const paths = data.paths ?? []
        if (paths.length === 0) return
        void importPaths(paths)
      }
    )
    return () => {
      off?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-8 shrink-0 items-center border-b border-border/50">
        <div className="flex h-full shrink-0 items-center">
          {TABS.map((t) => {
            const isActive = t.key === active
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className={cn(
                  "relative h-full px-3 text-[10px] font-medium uppercase tracking-wider transition-colors",
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground/70 hover:text-foreground"
                )}
              >
                {t.label}
                {/* layoutId lets motion slide the single rendered
                   underline across tabs instead of fading one in and
                   another out. */}
                {isActive && (
                  <motion.span
                    layoutId="library-tab-underline"
                    className="absolute inset-x-2 -bottom-px h-px bg-foreground"
                    transition={{
                      duration: 0.22,
                      ease: [0.32, 0.72, 0, 1],
                    }}
                  />
                )}
              </button>
            )
          })}
        </div>
        <span className="mx-1 h-4 w-px bg-border/60" />
        <div className="relative flex h-full flex-1 items-center px-2">
          <AnimatePresence mode="wait" initial={false}>
            {active === "bible" && (
              <motion.div
                key="bible-controls"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                className="flex h-full w-full items-center gap-2"
              >
                <BibleSearchInput
                  value={bibleSearch}
                  onChange={setBibleSearch}
                  onSubmit={onAdHocBibleRef}
                />
              </motion.div>
            )}
            {active === "songs" && (
              <motion.div
                key="songs-controls"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                className="flex h-full w-full items-center gap-2"
              >
                <SongSearchInput
                  value={songSearch}
                  onChange={setSongSearch}
                />
              </motion.div>
            )}
            {active === "media" && (
              <motion.div
                key="media-controls"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                className="flex h-full w-full items-center gap-2"
              >
                <MediaControls
                  search={mediaSearch}
                  onSearchChange={setMediaSearch}
                />
              </motion.div>
            )}
            {active === "templates" && (
              <motion.div
                key="templates-controls"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                className="flex h-full w-full items-center gap-2"
              >
                <TemplateSearchInput
                  value={templateSearch}
                  onChange={setTemplateSearch}
                />
              </motion.div>
            )}
            {active === "overlays" && (
              <motion.div
                key="overlays-controls"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                className="flex h-full w-full items-center gap-2"
              >
                <OverlaySearchInput
                  value={overlaySearch}
                  onChange={setOverlaySearch}
                />
              </motion.div>
            )}
            {active === "presentations" && (
              <motion.div
                key="presentations-controls"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -6 }}
                transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
                className="flex h-full w-full items-center gap-2"
              >
                <PresentationSearchInput
                  value={presentationSearch}
                  onChange={setPresentationSearch}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={active}
            className="h-full"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
          >
            {active === "bible" && (
              <BibleTab
                search={bibleSearch}
                onSubmit={onAdHocBibleRef}
              />
            )}
            {active === "songs" && <SongsTab search={songSearch} />}
            {active === "media" && (
              <MediaTab
                search={mediaSearch}
                importing={importing}
                onImport={openMediaFileDialog}
                dropTarget={MEDIA_DROP_TARGET}
                onPick={onMediaPick}
              />
            )}
            {active === "templates" && (
              <TemplatesTab
                search={templateSearch}
                onOpen={(t) =>
                  navigate({
                    to: "/templates/$templateId",
                    params: { templateId: t.id },
                  })
                }
              />
            )}
            {active === "overlays" && (
              <OverlaysTab
                search={overlaySearch}
                onOpen={(o) =>
                  navigate({
                    to: "/overlays/$overlayId",
                    params: { overlayId: String(o.id) },
                  })
                }
              />
            )}
            {active === "presentations" && (
              <PresentationsTab
                search={presentationSearch}
                onOpen={(p) =>
                  navigate({
                    to: "/presentations/$presentationId",
                    params: { presentationId: String(p.id) },
                  })
                }
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

// Smart search for bible references. Owns autocomplete (replace what the
// user typed with the canonical form once the parse settles) and
// segmented backspace (one press strips the deepest level — verse, then
// chapter+space, then the whole book).
function BibleSearchInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit?: (ref: AdHocBibleRef) => void
}) {
  const { data: books } = useQuery({
    queryKey: ["bible", "books"],
    queryFn: () => Bible.ListBooks() as unknown as Promise<BibleBook[]>,
  })
  const debounced = useDebounce(value, 200)
  const { navigateNext, navigatePrev } = useLive()
  const qc = useQueryClient()
  const { state: translations } = useBibleTranslations()

  // Track parse depth so the autocomplete only fires when the user
  // advances — typing a deeper level or switching to another book.
  // Without this guard the autocomplete would rebound a segmented
  // backspace right back into a canonical form.
  const lastBookRef = useRef("")
  const lastLevelRef = useRef(0)

  useEffect(() => {
    if (!books) return
    const text = debounced.trim()
    if (!text) {
      lastBookRef.current = ""
      lastLevelRef.current = 0
      return
    }
    const parsed = parseBibleRef(text, books)
    if (!parsed) {
      lastLevelRef.current = 0
      return
    }
    const level =
      parsed.verseStart !== undefined
        ? 3
        : parsed.chapter !== undefined
          ? 2
          : 1
    const advanced =
      parsed.book !== lastBookRef.current || level > lastLevelRef.current
    lastBookRef.current = parsed.book
    lastLevelRef.current = level
    if (!advanced) return
    const bookLabel =
      books.find((b) => b.name === parsed.book)?.name_kjv ?? parsed.book
    const canonical = formatBibleRef(
      bookLabel,
      parsed.chapter,
      parsed.verseStart,
      parsed.verseEnd
    )
    if (canonical !== debounced) onChange(canonical)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, books])

  // Enter hands the parsed range to the projector, which populates
  // the show pane with one slide per verse and auto-broadcasts the
  // first. Arrow keys then walk the range. Verse correction happens
  // here: out-of-range verses snap to the chapter's last verse, and
  // a reversed range (e.g. 6-1) is swapped to (1-6). Translation
  // doesn't matter for the count — every translation of the same
  // chapter has the same verse count.
  async function submitRef(text: string) {
    if (!books) return
    const parsed = parseBibleRef(text.trim(), books)
    if (!parsed?.chapter || parsed?.verseStart === undefined) return
    const bookLabel =
      books.find((b) => b.name === parsed.book)?.name_kjv ?? parsed.book

    const verses = (await qc.fetchQuery({
      queryKey: [
        "bible",
        "verses",
        parsed.book,
        parsed.chapter,
        translations.primary,
      ],
      queryFn: () =>
        Bible.ListVersesIn(
          parsed.book,
          parsed.chapter!,
          translations.primary
        ) as unknown as Promise<ChapterVerse[]>,
    })) as ChapterVerse[]
    const maxVerse = verses.length
    if (maxVerse === 0) return

    let start = Math.min(Math.max(1, parsed.verseStart), maxVerse)
    let end = Math.min(
      Math.max(1, parsed.verseEnd ?? parsed.verseStart),
      maxVerse
    )
    if (end < start) [start, end] = [end, start]

    onSubmit?.({
      book: parsed.book,
      bookLabel,
      chapter: parsed.chapter,
      verseStart: start,
      verseEnd: end,
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Char-level validation. Single-char alphanumeric keys are
    // checked; control keys (Backspace, ArrowDown, Enter, etc.) skip
    // to the navigation/submit branches below. Cmd/Ctrl combos are
    // skipped so paste/select-all still work — paste content gets
    // sanitized via the onPaste handler instead.
    if (e.key.length === 1 && !(e.metaKey || e.ctrlKey || e.altKey)) {
      // Global allowed set: letters, digits, space, period, colon,
      // hyphen, comma. Anything outside this is never valid in any
      // bible reference.
      if (!/^[A-Za-z0-9 .:,\-]$/.test(e.key)) {
        e.preventDefault()
        return
      }
      // Post-book restriction: once the current value parses to a
      // book, the rest of the input may only have digits / colon /
      // hyphen / comma / space. Letters and periods become invalid.
      if (/[A-Za-z.]/.test(e.key) && books) {
        const parsed = parseBibleRef(e.currentTarget.value.trim(), books)
        if (parsed?.book) {
          e.preventDefault()
          return
        }
      }
    }
    // Down/Up navigate the show pane's slide list even while typing.
    // The bible search holds a single reference, so up/down have no
    // meaningful in-input semantics — repurpose them for slide nav so
    // the operator never has to leave focus to walk verses.
    if (e.key === "ArrowDown") {
      e.preventDefault()
      navigateNext()
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      navigatePrev()
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      void submitRef(e.currentTarget.value)
      // Blur after submit so subsequent Esc clears live globally and
      // the operator doesn't have to click out to use other keybinds.
      e.currentTarget.blur()
      return
    }
    if (e.key === "Escape") {
      // First Esc blurs the input; the next one is caught globally
      // and clears live. Two presses, but matches the standard
      // "leave editing first" pattern.
      e.currentTarget.blur()
      return
    }
    if (e.key !== "Backspace") return
    if (!books) return
    const input = e.currentTarget
    // Only segment-delete when the caret is at the end with no selection
    // — otherwise the user is mid-editing and a normal backspace is right.
    if (
      input.selectionStart !== input.value.length ||
      input.selectionEnd !== input.value.length
    ) {
      return
    }
    const parsed = parseBibleRef(input.value.trim(), books)
    if (!parsed) return
    e.preventDefault()
    const bookLabel =
      books.find((b) => b.name === parsed.book)?.name_kjv ?? parsed.book
    let next: string
    let nextLevel: number
    if (parsed.verseStart !== undefined) {
      next = `${bookLabel} ${parsed.chapter}`
      nextLevel = 2
    } else if (parsed.chapter !== undefined) {
      // Match autocomplete's book-only canonical form (trailing space)
      // so the next debounce pass doesn't see this as non-canonical and
      // rebound the autocomplete on top of us.
      next = `${bookLabel} `
      nextLevel = 1
    } else {
      next = ""
      nextLevel = 0
    }
    // Sync the autocomplete tracker so the upcoming debounce doesn't
    // count this shorter form as a fresh "advance" and rewrite it.
    lastBookRef.current = parsed.book
    lastLevelRef.current = nextLevel
    onChange(next)
  }

  return (
    <div className="relative h-6 w-full max-w-[260px]">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search a reference — e.g. John 3:16"
        data-library-search
        className="h-6 rounded-none border-0 bg-transparent pl-7 pr-2 py-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}

function SongSearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative h-6 w-full max-w-[260px]">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search songs"
        data-library-search
        className="h-6 rounded-none border-0 bg-transparent pl-7 pr-2 py-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}

function TemplateSearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative h-6 w-full max-w-[260px]">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search templates"
        data-library-search
        className="h-6 rounded-none border-0 bg-transparent pl-7 pr-2 py-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}

function OverlaySearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative h-6 w-full max-w-[260px]">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search overlays"
        data-library-search
        className="h-6 rounded-none border-0 bg-transparent pl-7 pr-2 py-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}

function PresentationSearchInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="relative h-6 w-full max-w-[260px]">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search presentations"
        data-library-search
        className="h-6 rounded-none border-0 bg-transparent pl-7 pr-2 py-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}

function MediaControls({
  search,
  onSearchChange,
}: {
  search: string
  onSearchChange: (v: string) => void
}) {
  return (
    <div className="relative h-6 w-full max-w-[220px]">
      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
      <Input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search media"
        data-library-search
        className="h-6 rounded-none border-0 bg-transparent pl-7 pr-2 py-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}

