import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { RotateCcwIcon, Trash2Icon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"
import {
  useBackgrounds,
  useCreateBackground,
  useDeleteBackground,
} from "@/features/backgrounds/api"
import { BackgroundView } from "@/features/backgrounds/background-view"
import {
  isDefaultBackgroundId,
  type BackgroundDoc,
} from "@/features/backgrounds/presets"
import { AddTile } from "@/features/library/add-tile"

type Props = {
  search: string
  onOpen: (background: BackgroundDoc) => void
}

// BackgroundsTab — tile grid mirroring Templates / Overlays. Each tile
// is a LIVE BackgroundView (the whole point of a background is its
// motion; a static thumbnail sells none of it). The grid holds a
// handful of small canvases, bounded by how many backgrounds exist.
// Seeds carry a Default badge (Edited when shadowed); deleting a
// shadow restores the seed, deleting a user row removes it (schedule
// assignments pointing at it fall back to inherit).
export function BackgroundsTab({ search, onOpen }: Props) {
  const { data: backgrounds, rows, isLoading } = useBackgrounds()
  const createMut = useCreateBackground()
  const deleteMut = useDeleteBackground()
  const debounced = useDebounce(search, 200)

  const filtered = useMemo(() => {
    const list = backgrounds ?? []
    const needle = debounced.trim().toLowerCase()
    if (!needle) return list
    return list.filter((b) => b.name.toLowerCase().includes(needle))
  }, [backgrounds, debounced])

  if (isLoading) return <Empty>Loading…</Empty>

  return (
    <div className="h-full w-full overflow-y-auto p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        <AnimatePresence initial={false}>
          {filtered.map((b) => (
            <BackgroundTile
              key={b.id}
              background={b}
              shadowed={
                isDefaultBackgroundId(b.id) &&
                !!rows?.some((r) => r.id === b.id)
              }
              onOpen={() => onOpen(b)}
              onDelete={() => deleteMut.mutate(b.id)}
            />
          ))}
        </AnimatePresence>
        <AddTile
          label="Add background"
          sublabel="New"
          onClick={() =>
            createMut.mutate(
              {
                name: "Untitled background",
                engine: "gradflow",
                configJSON: JSON.stringify({
                  type: "silk",
                  color1: "#e0e0e0",
                  color2: "#0d0d0d",
                  color3: "#8c8c8c",
                  speed: 0.4,
                  scale: 1.2,
                  noise: 0.15,
                }),
              },
              { onSuccess: (created) => onOpen(created as BackgroundDoc) }
            )
          }
        />
      </div>
      {filtered.length === 0 && (
        <Empty>No matches.</Empty>
      )}
    </div>
  )
}

function BackgroundTile({
  background,
  shadowed,
  onOpen,
  onDelete,
}: {
  background: BackgroundDoc
  shadowed: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const isSeed = isDefaultBackgroundId(background.id)
  // Pristine seeds have no DB row — nothing to delete or restore.
  const deletable = !isSeed || shadowed

  const [pendingDelete, setPendingDelete] = useState(false)
  const tileRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!pendingDelete) return
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (tileRef.current?.contains(target)) return
      setPendingDelete(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [pendingDelete])

  return (
    <motion.div
      ref={tileRef}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
      className="group relative flex flex-col overflow-hidden border border-border/50 bg-background transition-colors hover:border-border"
    >
      <button type="button" onClick={onOpen} className="block text-left">
        <div className="relative aspect-video w-full overflow-hidden bg-black">
          <BackgroundView
            background={{
              background_id: background.id,
              engine: background.engine,
              config_json: background.config_json,
            }}
          />
        </div>
      </button>
      <div className="flex items-center gap-1.5 border-t border-border/40 px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {background.name}
        </span>
        {isSeed && (
          <span className="shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground/60">
            {shadowed ? "Edited" : "Default"}
          </span>
        )}
      </div>
      {deletable && (
        <span
          role="button"
          aria-label={
            pendingDelete
              ? "Confirm"
              : isSeed
                ? "Restore default"
                : "Delete"
          }
          title={isSeed ? "Restore default" : "Delete"}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            if (pendingDelete) {
              onDelete()
              setPendingDelete(false)
            } else {
              setPendingDelete(true)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              e.stopPropagation()
              if (pendingDelete) {
                onDelete()
                setPendingDelete(false)
              } else {
                setPendingDelete(true)
              }
            }
          }}
          className={cn(
            "absolute right-1.5 top-1.5 grid size-6 cursor-pointer place-items-center transition-opacity",
            pendingDelete
              ? "bg-destructive text-destructive-foreground opacity-100"
              : "bg-background/70 text-muted-foreground backdrop-blur opacity-0 hover:bg-destructive/30 hover:text-destructive group-hover:opacity-100"
          )}
        >
          {pendingDelete ? (
            <XIcon className="size-3.5" />
          ) : isSeed ? (
            <RotateCcwIcon className="size-3.5" />
          ) : (
            <Trash2Icon className="size-3.5" />
          )}
        </span>
      )}
    </motion.div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center text-xs text-muted-foreground/40">
      {children}
    </div>
  )
}
