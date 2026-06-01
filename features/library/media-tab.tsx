import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSessionState } from "@/hooks/use-session-state"
import {
  ImageIcon,
  FilmIcon,
  FileAudioIcon,
  FileTextIcon,
  FileIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { AddTile } from "@/features/library/add-tile"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { Medium } from "@/bindings/neoprojector/database"
import { cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"

export type MediaKind = "all" | "image" | "video" | "audio" | "pdf"

type Props = {
  search: string
  kind?: MediaKind
  importing: boolean
  onImport: () => void | Promise<void>
  dropTarget: string
  // Called when the operator clicks a media tile. The parent
  // appends to the "Media from Library" inbox and surfaces the new
  // schedule item in the show pane. When undefined, clicks fall
  // back to the local-only "selected" highlight.
  onPick?: (mediaId: number) => void
}

export function MediaTab({
  search,
  kind = "all",
  importing,
  onImport,
  dropTarget,
  onPick,
}: Props) {
  const qc = useQueryClient()
  const { data: media, isLoading } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
  })
  const [selectedId, setSelectedId] = useSessionState<number | null>(
    "neoprojector.mediaSelectedId",
    null
  )

  // Delete-with-confirm mirrors the templates / overlays tabs: first
  // click on the trash icon arms (turns red); second click commits.
  // We invalidate the media list query on success so the tile
  // disappears immediately and the show pane drops a stale preview.
  const deleteMut = useMutation({
    mutationFn: (id: number) => Media.DeleteMedia(id) as unknown as Promise<void>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media", "list"] })
    },
  })

  const debounced = useDebounce(search, 200)

  const filtered = useMemo(() => {
    const list = media ?? []
    const needle = debounced.trim().toLowerCase()
    return list.filter((m) => {
      if (kind !== "all" && m.type !== kind) return false
      if (!needle) return true
      return (
        m.title.toLowerCase().includes(needle) ||
        m.original_filename.toLowerCase().includes(needle)
      )
    })
  }, [media, kind, debounced])

  return (
    <div className="flex h-full w-full flex-col">
      <div
        data-file-drop-target={dropTarget}
        className="relative min-h-0 flex-1 overflow-y-auto p-3"
      >
        {isLoading ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground/40">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <button
            type="button"
            onClick={() => void onImport()}
            className="grid h-full w-full place-items-center gap-2 rounded border border-dashed border-border/50 text-center text-xs text-muted-foreground/50 transition-colors hover:border-border hover:text-muted-foreground"
          >
            <UploadIcon className="size-6 opacity-60" />
            <div>
              {importing ? "Importing…" : "Drop files here or click to add media"}
            </div>
          </button>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
            {filtered.map((m) => (
              <MediaTile
                key={m.id}
                medium={m}
                active={m.id === selectedId}
                onSelect={() => {
                  setSelectedId(m.id)
                  onPick?.(m.id)
                }}
                onDelete={() => {
                  deleteMut.mutate(m.id)
                  if (selectedId === m.id) setSelectedId(null)
                }}
              />
            ))}
            <AddTile
              label="Add media"
              sublabel="Import"
              busyLabel="Importing…"
              busy={importing}
              onClick={() => void onImport()}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function MediaTile({
  medium,
  active,
  onSelect,
  onDelete,
}: {
  medium: Medium
  active: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const Icon = iconFor(medium.type)
  const [pendingDelete, setPendingDelete] = useState(false)
  const tileRef = useRef<HTMLDivElement | null>(null)

  // Click anywhere outside the tile cancels a pending delete — same
  // affordance as the templates / overlays tabs. Without this, the
  // red "click to confirm" state would persist until the user
  // explicitly cancels, which is a footgun.
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
    <div
      ref={tileRef}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded border bg-background transition-colors",
        active
          ? "border-foreground/60 ring-1 ring-foreground/40"
          : "border-border/50 hover:border-border"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        title={medium.original_filename}
        className="block text-left"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-muted/40">
          {medium.type === "image" ? (
            <img
              src={`/media-asset/${medium.id}`}
              alt={medium.title}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          ) : medium.type === "video" ? (
            <video
              src={`/media-asset/${medium.id}`}
              className="absolute inset-0 h-full w-full object-cover"
              preload="auto"
              muted
              playsInline
              // Seek to ~0.5s once metadata is ready so the tile shows
              // a frame mid-action instead of the often-black first
              // frame. preload="auto" makes sure enough bytes are
              // buffered to satisfy the seek.
              onLoadedMetadata={(e) => {
                const el = e.currentTarget
                const t = Math.min(0.5, Math.max(0, (el.duration || 0) - 0.1))
                if (Number.isFinite(t) && t > 0) el.currentTime = t
              }}
            />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground/60">
              <Icon className="size-6 opacity-70" />
            </div>
          )}
        </div>
      </button>
      <div
        className={cn(
          "flex flex-col gap-0.5 border-t border-border/40 px-2 py-1.5",
          active
            ? "text-foreground"
            : "text-muted-foreground group-hover:text-foreground"
        )}
      >
        <span className="truncate text-[11px] font-medium">
          {medium.title}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
          {medium.type}
        </span>
      </div>
      {/* Delete affordance — hover-revealed in the top-right corner.
          A `span role="button"` so it isn't a nested button (invalid
          HTML); identical pattern to templates / overlays tiles. */}
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
    </div>
  )
}

function iconFor(type: string) {
  switch (type) {
    case "image":
      return ImageIcon
    case "video":
      return FilmIcon
    case "audio":
      return FileAudioIcon
    case "pdf":
      return FileTextIcon
    default:
      return FileIcon
  }
}
