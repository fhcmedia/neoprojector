import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useQuery } from "@tanstack/react-query"
import { FilmIcon, ImageIcon, Trash2Icon, XIcon } from "lucide-react"
import { useDebounce } from "@/hooks/use-debounce"
import { cn } from "@/lib/utils"
import {
  useDeletePresentation,
  usePresentations,
  usePresentationSlides,
} from "@/features/presentations/api"
import type { Presentation, Medium } from "@/bindings/neoprojector/database"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import { useVideoAssetUrl } from "@/lib/media-url"

type Props = {
  search: string
}

// PresentationsTab — tile grid mirroring the Templates / Overlays
// tabs. Each tile previews the first slide (or shows a placeholder
// when empty), the presentation name, and a slide count. Read-only
// until the Show-surface presentation editor lands: existing rows
// can be scheduled and played, but there's no editor to create or
// modify them with, so the add tile is gone.
export function PresentationsTab({ search }: Props) {
  const { data: presentations, isLoading } = usePresentations()
  const deleteMut = useDeletePresentation()
  const debounced = useDebounce(search, 200)

  const filtered = useMemo(() => {
    const list = presentations ?? []
    const needle = debounced.trim().toLowerCase()
    if (!needle) return list
    return list.filter((p) => p.name.toLowerCase().includes(needle))
  }, [presentations, debounced])

  if (isLoading) return <Empty>Loading…</Empty>

  return (
    <div className="h-full w-full overflow-y-auto p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        <AnimatePresence initial={false}>
          {filtered.map((p) => (
            <PresentationTile
              key={p.id}
              presentation={p}
              onDelete={() => deleteMut.mutate(p.id)}
            />
          ))}
        </AnimatePresence>
      </div>
      {filtered.length === 0 && (
        <Empty>
          {presentations && presentations.length === 0
            ? "No presentations yet."
            : "No matches."}
        </Empty>
      )}
    </div>
  )
}

function PresentationTile({
  presentation,
  onDelete,
}: {
  presentation: Presentation
  onDelete: () => void
}) {
  const { data: slides } = usePresentationSlides(presentation.id)
  const { data: mediaList } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
    staleTime: 60_000,
  })
  const mediaById = useMemo(() => {
    return new Map((mediaList ?? []).map((m) => [m.id, m]))
  }, [mediaList])
  const firstSlide = slides && slides.length > 0 ? slides[0] : null
  const firstMedium =
    firstSlide && firstSlide.media_id !== null
      ? mediaById.get(firstSlide.media_id) ?? null
      : null
  const count = slides?.length ?? 0
  const videoSrc = useVideoAssetUrl(
    firstMedium?.type === "video" ? firstSlide?.media_id : undefined
  )

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
      className="group relative flex flex-col overflow-hidden rounded border border-border/50 bg-background transition-colors hover:border-border"
    >
      <div className="block text-left">
        <div className="relative aspect-video w-full overflow-hidden bg-muted/40">
          {firstMedium?.type === "image" && firstSlide ? (
            <img
              src={`/media-asset/${firstSlide.media_id}`}
              alt={firstMedium.title || ""}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          ) : firstMedium?.type === "video" && firstSlide ? (
            <video
              src={videoSrc}
              className="absolute inset-0 h-full w-full object-cover"
              preload="metadata"
              muted
            />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground/40">
              <ImageIcon className="size-6" />
            </div>
          )}
          {count > 0 && (
            <span className="pointer-events-none absolute bottom-1.5 right-1.5 grid h-5 min-w-5 place-items-center rounded bg-background/80 px-1.5 text-[10px] font-medium text-foreground backdrop-blur">
              {count}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 border-t border-border/40 px-2 py-1.5">
        <span className="truncate text-[11px] font-medium text-foreground">
          {presentation.name}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
          <FilmIcon className="inline size-2.5 mr-1" />
          {count} slide{count === 1 ? "" : "s"}
        </span>
      </div>
      <span
        role="button"
        aria-label={pendingDelete ? "Confirm delete" : "Delete"}
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
          "absolute right-1.5 top-1.5 grid size-6 cursor-pointer place-items-center rounded transition-opacity",
          pendingDelete
            ? "bg-destructive text-destructive-foreground opacity-100"
            : "bg-background/70 text-muted-foreground backdrop-blur opacity-0 hover:bg-destructive/30 hover:text-destructive group-hover:opacity-100"
        )}
      >
        {pendingDelete ? (
          <XIcon className="size-3.5" />
        ) : (
          <Trash2Icon className="size-3.5" />
        )}
      </span>
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
