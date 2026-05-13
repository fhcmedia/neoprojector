import { useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { SearchIcon, MusicIcon } from "lucide-react"
import { Input } from "@/components/input"
import { cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"
import { songSectionType } from "@/features/songs/section-types"
import {
  pickerContainerVariants,
  pickerRowVariants,
} from "@/features/schedule/picker-anim"
import { useLibrarySongs, useLibrarySong } from "@/features/library/api"

export function SongsTab() {
  const { data: songs, isLoading } = useLibrarySongs()
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<number | null>(null)

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
        <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/40 px-2">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search songs"
            className="h-6 border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0"
          />
        </div>
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
      <div className="flex-1 overflow-y-auto">
        <motion.div
          key={songId}
          className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))]"
          variants={sectionsGridVariants}
          initial="hidden"
          animate="visible"
        >
          {data.sections.map((sec) => {
            const t = songSectionType(sec.section.type)
            return (
              <motion.div
                key={sec.section.id}
                variants={sectionTileVariants}
                className="flex flex-col border-b border-r border-border/40"
              >
                <div
                  className={cn(
                    "px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider",
                    t.chip,
                    t.text
                  )}
                >
                  {t.label}
                </div>
                <div className={cn("flex-1 px-4 py-2", t.body)}>
                  {sec.lines.map((line) => (
                    <div
                      key={line.id}
                      className="text-xs leading-relaxed text-foreground/90"
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
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

const sectionsGridVariants = {
  visible: {
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
  hidden: {},
}

const sectionTileVariants = {
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 500, damping: 30 },
  },
  hidden: { opacity: 0, y: -6 },
}
