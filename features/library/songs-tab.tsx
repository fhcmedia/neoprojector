import { useCallback, useEffect, useMemo } from "react"
import { AnimatePresence, motion } from "motion/react"
import { MusicIcon, RadioIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"
import { useSessionState } from "@/hooks/use-session-state"
import {
  pickerContainerVariants,
  pickerRowVariants,
} from "@/features/schedule/picker-anim"
import { useLibrarySongs, useLibrarySong } from "@/features/library/api"
import { useLive } from "@/features/live/live-context"
import { buildSongSlides } from "@/features/live/slides"
import { SongShowView } from "@/features/show/show-content-views"

export function SongsTab({ search }: { search: string }) {
  const { data: songs, isLoading } = useLibrarySongs()
  const [selectedId, setSelectedId] = useSessionState<number | null>(
    "neoprojector.songSelectedId",
    null
  )

  const debounced = useDebounce(search, 200)

  const list = songs ?? []
  const needle = debounced.trim().toLowerCase()
  const filtered = needle
    ? list.filter((s) => s.title.toLowerCase().includes(needle))
    : list

  return (
    <motion.div
      className="flex h-full w-full"
      variants={pickerContainerVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
    >
      <motion.div
        variants={pickerRowVariants}
        className="flex h-full w-[30%] min-w-[200px] flex-col border-r border-border/50"
      >
        <div className="flex flex-1 flex-col overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground/60">
              Loading…
            </div>
          ) : (
            <motion.div
              variants={songListVariants}
              initial="hidden"
              animate="visible"
            >
              <AnimatePresence initial={false}>
                {filtered.map((song) => {
                  const isActive = song.id === selectedId
                  return (
                    <motion.button
                      key={song.id}
                      type="button"
                      layout
                      variants={songItemVariants}
                      onClick={() => setSelectedId(song.id)}
                      className={cn(
                        "flex w-full items-center gap-2 border-b border-border/40 px-3 py-1.5 text-left text-xs transition-colors",
                        isActive
                          ? "bg-muted text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      )}
                    >
                      <MusicIcon className="size-3.5 shrink-0 opacity-70" />
                      <span className="truncate">{song.title}</span>
                    </motion.button>
                  )
                })}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </motion.div>

      <motion.div variants={pickerRowVariants} className="flex h-full flex-1">
        <SongPreview songId={selectedId} />
      </motion.div>
    </motion.div>
  )
}

function SongPreview({ songId }: { songId: number | null }) {
  const { data, isLoading } = useLibrarySong(songId)
  const { setLive, live, clearLive, isLive, registerNavigators } = useLive()

  // Same chunking useSongSlides uses for schedule items (blank lines
  // inside a section split it into separate same-numbered slides) —
  // sharing this keeps "slide N" meaning the same thing, and the
  // rendered text identical, whether a song is sent live from here
  // or from a schedule item in Show pane.
  const slides = useMemo(() => (data ? buildSongSlides(data) : []), [data])
  const isSongLive = live?.kind === "song" && live?.sourceItemId === null

  const sendIndex = useCallback(
    (idx: number) => {
      const slide = slides[idx]
      if (!slide) return
      setLive({
        channel: "slide",
        kind: "song",
        sourceItemId: null,
        slideIndex: idx,
        fill: slide.fill,
      })
    },
    [slides, setLive]
  )

  // Claims the shared arrow-key navigator slot only while THIS song
  // is the one actually live. Show pane's own navigator effect yields
  // under the mirror-image condition (live.sourceItemId === null &&
  // live.kind === "song"), so exactly one of the two ever registers
  // for a given live state — no race on which effect runs last.
  // Clamps at both ends (no wrap), matching how Show pane navigates
  // song slides from a schedule item.
  useEffect(() => {
    if (!isSongLive || !live) return
    registerNavigators({
      next: () => {
        if (live.slideIndex + 1 < slides.length) sendIndex(live.slideIndex + 1)
      },
      prev: () => {
        if (live.slideIndex > 0) sendIndex(live.slideIndex - 1)
      },
    })
  }, [isSongLive, live, slides, registerNavigators, sendIndex])

  if (!songId) {
    return (
      <div className="grid h-full flex-1 place-items-center text-xs text-muted-foreground/40">
        Select a song
      </div>
    )
  }
  if (isLoading || !data) {
    return (
      <div className="grid h-full flex-1 place-items-center text-xs text-muted-foreground/40">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-1 flex-col">
      {isSongLive && (
        <div className="flex items-center gap-2 border-b border-border/40 bg-chart-2/10 px-3 py-1.5">
          <RadioIcon className="size-3 text-chart-2" />
          <span className="flex-1 truncate text-[11px] text-chart-2 dark:text-chart-2">
            Live — {data.song.title}
          </span>
          <button
            type="button"
            onClick={clearLive}
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
      <SongShowView
        slides={slides}
        isLiveAt={(idx) => isLive("song", null, idx)}
        onSelect={(idx) => {
          if (isLive("song", null, idx)) {
            clearLive()
            return
          }
          sendIndex(idx)
        }}
      />
    </div>
  )
}

const songListVariants = {
  visible: {
    transition: { staggerChildren: 0.025, delayChildren: 0.05 },
  },
  hidden: {},
}

const songItemVariants = {
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 500, damping: 32 },
  },
  hidden: { opacity: 0, y: -6 },
}
