import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useQueryClient } from "@tanstack/react-query"
import { SearchIcon } from "lucide-react"
import { Dialogs, Events } from "@wailsio/runtime"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import { Input } from "@/components/input"
import { cn } from "@/lib/utils"
import { BibleTab } from "@/features/library/bible-tab"
import { SongsTab } from "@/features/library/songs-tab"
import { MediaTab } from "@/features/library/media-tab"

type Tab = "bible" | "songs" | "media"

const TABS: { key: Tab; label: string }[] = [
  { key: "bible", label: "Bible" },
  { key: "songs", label: "Songs" },
  { key: "media", label: "Media" },
]

const MEDIA_DROP_EVENT = "media:files-dropped"
const MEDIA_DROP_TARGET = "library-media"

type MediaDropPayload = {
  paths?: string[]
  target_id?: string
}

export function LibraryView() {
  const [active, setActive] = useState<Tab>("bible")

  // Search/filter state lives here so the controls can sit in the same
  // row as the tabs while the body of each tab stays a pure consumer.
  const [songSearch, setSongSearch] = useState("")
  const [mediaSearch, setMediaSearch] = useState("")

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
      Events.Off(MEDIA_DROP_EVENT)
      void off
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
            {active === "bible" && <BibleTab />}
            {active === "songs" && <SongsTab search={songSearch} />}
            {active === "media" && (
              <MediaTab
                search={mediaSearch}
                importing={importing}
                onImport={openMediaFileDialog}
                dropTarget={MEDIA_DROP_TARGET}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
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
        className="h-6 rounded-none border-0 bg-transparent pl-7 pr-2 py-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
    </div>
  )
}

