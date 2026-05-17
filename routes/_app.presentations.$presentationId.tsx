import { useEffect, useMemo, useRef, useState } from "react"
import {
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
  ImageIcon,
  InfinityIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  useAddSlide,
  useDeleteSlide,
  usePresentation,
  usePresentationSlides,
  useRenamePresentation,
  useReorderSlides,
  useUpdatePlayback,
} from "@/features/presentations/api"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type {
  Medium,
  Presentation,
} from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"

export const Route = createFileRoute(
  "/_app/presentations/$presentationId"
)({
  component: PresentationEditor,
})

// All renderer-supported transition kinds. Kept inline (single source
// of truth lives in features/templates/types.ts, but importing the
// full type machinery here just for an enum list is heavier than the
// duplication). Pair with the labels in TRANSITION_LABELS below.
const TRANSITION_KINDS = [
  "none",
  "fade",
  "slide-up",
  "slide-down",
  "slide-left",
  "slide-right",
  "scale",
  "blur",
] as const
type TransitionKind = (typeof TRANSITION_KINDS)[number]

const TRANSITION_LABELS: Record<TransitionKind, string> = {
  none: "None (instant cut)",
  fade: "Fade",
  "slide-up": "Slide up",
  "slide-down": "Slide down",
  "slide-left": "Slide left",
  "slide-right": "Slide right",
  scale: "Scale",
  blur: "Blur",
}

function PresentationEditor() {
  const { presentationId: idStr } = Route.useParams()
  const id = Number(idStr)
  const navigate = useNavigate()
  const { data: presentation } = usePresentation(id)
  const { data: slides } = usePresentationSlides(id)
  const renameMut = useRenamePresentation()
  const addSlide = useAddSlide(id)
  const deleteSlide = useDeleteSlide(id)
  const reorder = useReorderSlides(id)

  // Local-edited name so typing doesn't fight the query cache.
  // Only flushes to the backend on blur / Enter — feels closer to
  // file-rename UX than a live every-keystroke update.
  const [name, setName] = useState("")
  useEffect(() => {
    if (presentation) setName(presentation.name)
  }, [presentation])

  function commitName() {
    if (!presentation) return
    const trimmed = name.trim()
    if (trimmed === "" || trimmed === presentation.name) {
      setName(presentation.name)
      return
    }
    renameMut.mutate({ id, name: trimmed })
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 items-center gap-3 border-b border-border/40 px-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/" })}
          className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
            if (e.key === "Escape" && presentation) {
              setName(presentation.name)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="h-8 max-w-[480px] text-sm"
          placeholder="Untitled presentation"
        />
        <span className="ml-auto text-[11px] text-muted-foreground/60">
          {slides?.length ?? 0} slide{(slides?.length ?? 0) === 1 ? "" : "s"}
        </span>
      </header>

      {presentation && <SettingsBar presentation={presentation} />}

      <div className="grid min-h-0 flex-1 grid-cols-[3fr_2fr] gap-3 p-3">
        <SlideList
          slides={slides ?? []}
          onDelete={(slideId) => deleteSlide.mutate(slideId)}
          onReorder={(ids) => reorder.mutate(ids)}
        />
        <MediaPicker onPick={(mediaId) => addSlide.mutate(mediaId)} />
      </div>
    </div>
  )
}

// --- Settings bar (loop + transition) ---------------------------------------

function SettingsBar({ presentation }: { presentation: Presentation }) {
  const updateMut = useUpdatePlayback(presentation.id)
  // Mirror the persisted state locally so a draft change isn't lost
  // mid-typing in the seconds input. Resync if the presentation row
  // is invalidated and re-arrives with a different value (rare).
  const [loop, setLoop] = useState(presentation.loop === 1)
  const [intervalMs, setIntervalMs] = useState(presentation.interval_ms)
  const [kind, setKind] = useState<TransitionKind>(
    (presentation.transition_kind as TransitionKind) || "fade"
  )
  const [durationMs, setDurationMs] = useState(
    presentation.transition_duration_ms
  )
  useEffect(() => {
    setLoop(presentation.loop === 1)
    setIntervalMs(presentation.interval_ms)
    setKind((presentation.transition_kind as TransitionKind) || "fade")
    setDurationMs(presentation.transition_duration_ms)
  }, [presentation.id])

  function commit(next: {
    loop?: boolean
    intervalMs?: number
    kind?: TransitionKind
    durationMs?: number
  }) {
    updateMut.mutate({
      loop: next.loop ?? loop,
      interval_ms: next.intervalMs ?? intervalMs,
      transition_kind: next.kind ?? kind,
      transition_duration_ms: next.durationMs ?? durationMs,
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border/40 bg-muted/20 px-4 py-2 text-[11px]">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={loop}
          onChange={(e) => {
            const v = e.target.checked
            setLoop(v)
            commit({ loop: v })
          }}
          className="size-3.5 cursor-pointer accent-foreground"
        />
        <InfinityIcon className="size-3.5 text-muted-foreground" />
        <span className="text-foreground">Auto-advance (loop)</span>
      </label>

      <label
        className={cn(
          "flex items-center gap-2 transition-opacity",
          loop ? "opacity-100" : "opacity-50"
        )}
      >
        <span className="text-muted-foreground">Every</span>
        <input
          type="number"
          min={0.5}
          step={0.5}
          value={(intervalMs / 1000).toFixed(1)}
          onChange={(e) => {
            const s = parseFloat(e.target.value)
            if (!Number.isFinite(s)) return
            const ms = Math.max(250, Math.round(s * 1000))
            setIntervalMs(ms)
          }}
          onBlur={() => commit({ intervalMs })}
          disabled={!loop}
          className="h-6 w-16 rounded border border-border/50 bg-background px-2 text-right text-[11px] tabular-nums outline-none focus-visible:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="text-muted-foreground">seconds</span>
      </label>

      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Transition</span>
        <select
          value={kind}
          onChange={(e) => {
            const v = e.target.value as TransitionKind
            setKind(v)
            commit({ kind: v })
          }}
          className="h-6 rounded border border-border/50 bg-background px-2 text-[11px] outline-none focus-visible:border-foreground/40"
        >
          {TRANSITION_KINDS.map((k) => (
            <option key={k} value={k}>
              {TRANSITION_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Duration</span>
        <input
          type="number"
          min={0}
          step={50}
          value={durationMs}
          onChange={(e) => {
            const ms = Math.max(0, Math.round(Number(e.target.value)))
            if (!Number.isFinite(ms)) return
            setDurationMs(ms)
          }}
          onBlur={() => commit({ durationMs })}
          className="h-6 w-16 rounded border border-border/50 bg-background px-2 text-right text-[11px] tabular-nums outline-none focus-visible:border-foreground/40"
        />
        <span className="text-muted-foreground">ms</span>
      </label>
    </div>
  )
}

// --- Slide list -------------------------------------------------------------

function SlideList({
  slides,
  onDelete,
  onReorder,
}: {
  slides: ReturnType<typeof usePresentationSlides>["data"] extends infer T
    ? T extends undefined
      ? never
      : T
    : never
  onDelete: (slideId: number) => void
  onReorder: (ids: number[]) => void
}) {
  const qc = useQueryClient()
  const mediaById = useMemo(() => {
    const list = qc.getQueryData<Medium[]>(["media", "list"]) ?? []
    return new Map(list.map((m) => [m.id, m]))
  }, [qc, slides])

  // Drag-to-reorder. Hold a row, drop it on another row, that row's
  // index becomes the dragged row's new position. Keeps the UX
  // simple while we don't have a proper dnd library in this surface.
  const [dragId, setDragId] = useState<number | null>(null)

  function moveDraggedToBefore(targetId: number) {
    if (dragId === null || dragId === targetId) return
    const ids = slides.map((s) => s.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0) return
    const next = ids.slice()
    next.splice(from, 1)
    next.splice(from < to ? to : to, 0, dragId)
    onReorder(next)
  }

  function shiftBy(slideId: number, delta: number) {
    const ids = slides.map((s) => s.id)
    const idx = ids.indexOf(slideId)
    if (idx < 0) return
    const target = idx + delta
    if (target < 0 || target >= ids.length) return
    const next = ids.slice()
    next.splice(idx, 1)
    next.splice(target, 0, slideId)
    onReorder(next)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded border border-border/40">
      <div className="border-b border-border/40 bg-muted/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Slides
      </div>
      <div className="flex-1 overflow-y-auto">
        {slides.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-muted-foreground/40">
            No slides yet. Click a media item on the right to add it.
          </div>
        ) : (
          <ul className="flex flex-col">
            {slides.map((s, idx) => {
              const m = mediaById.get(s.media_id)
              const isFirst = idx === 0
              const isLast = idx === slides.length - 1
              return (
                <li
                  key={s.id}
                  draggable
                  onDragStart={() => setDragId(s.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = "move"
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    moveDraggedToBefore(s.id)
                    setDragId(null)
                  }}
                  className={cn(
                    "group flex items-center gap-3 border-b border-border/30 px-3 py-2 transition-colors hover:bg-muted/20",
                    dragId === s.id && "opacity-50"
                  )}
                >
                  <GripVerticalIcon className="size-3.5 cursor-grab text-muted-foreground/40" />
                  <span className="w-6 text-right font-mono text-[10px] text-muted-foreground/60">
                    {idx + 1}
                  </span>
                  <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded bg-muted/40 ring-1 ring-border/40">
                    {m?.type === "image" ? (
                      <img
                        src={`/media-asset/${s.media_id}`}
                        alt={m.title || ""}
                        className="h-full w-full object-cover"
                      />
                    ) : m?.type === "video" ? (
                      <video
                        src={`/media-asset/${s.media_id}`}
                        className="h-full w-full object-cover"
                        muted
                        preload="metadata"
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-muted-foreground/40">
                        <ImageIcon className="size-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[12px] text-foreground">
                      {m?.title || `Media #${s.media_id}`}
                    </span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                      {m?.type ?? "missing"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => shiftBy(s.id, -1)}
                      disabled={isFirst}
                      className="grid size-5 place-items-center rounded text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Move up"
                    >
                      <ChevronUpIcon className="size-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftBy(s.id, 1)}
                      disabled={isLast}
                      className="grid size-5 place-items-center rounded text-muted-foreground/70 hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                      aria-label="Move down"
                    >
                      <ChevronDownIcon className="size-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDelete(s.id)}
                    aria-label="Remove slide"
                    className="grid size-7 place-items-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

// --- Media picker -----------------------------------------------------------

function MediaPicker({ onPick }: { onPick: (mediaId: number) => void }) {
  const { data: media, isLoading } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
  })
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const list = media ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.original_filename.toLowerCase().includes(q)
    )
  }, [media, query])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded border border-border/40">
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Add slide
        </span>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search media…"
          className="h-6 flex-1 max-w-[260px] text-[11px]"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground/40">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-muted-foreground/40">
            {!media || media.length === 0
              ? "No media yet. Import some from the Media tab first."
              : "No matches."}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {filtered.map((m) => (
              <MediaPickerTile key={m.id} medium={m} onPick={() => onPick(m.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MediaPickerTile({
  medium,
  onPick,
}: {
  medium: Medium
  onPick: () => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  return (
    <button
      type="button"
      onClick={onPick}
      onMouseEnter={() => {
        if (medium.type === "video" && videoRef.current) {
          void videoRef.current.play().catch(() => {})
        }
      }}
      onMouseLeave={() => {
        if (medium.type === "video" && videoRef.current) {
          videoRef.current.pause()
          videoRef.current.currentTime = 0
        }
      }}
      className="group flex flex-col overflow-hidden rounded border border-border/40 bg-background text-left transition-colors hover:border-border hover:ring-1 hover:ring-border/60"
      title={`Add ${medium.title}`}
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
            ref={videoRef}
            src={`/media-asset/${medium.id}`}
            className="absolute inset-0 h-full w-full object-cover"
            preload="metadata"
            muted
            loop
          />
        ) : medium.type === "audio" ? (
          <div className="grid h-full place-items-center text-muted-foreground/60">
            <PlayIcon className="size-6 opacity-70" />
          </div>
        ) : (
          <div className="grid h-full place-items-center text-muted-foreground/60">
            <ImageIcon className="size-6 opacity-70" />
          </div>
        )}
        {medium.type === "video" && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground backdrop-blur">
            Video
          </span>
        )}
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-background/60 text-foreground opacity-0 transition-opacity group-hover:opacity-100">
          <PlusIcon className="size-6" />
        </span>
      </div>
      <div className="truncate border-t border-border/40 px-2 py-1 text-[10px] text-muted-foreground group-hover:text-foreground">
        {medium.title}
      </div>
    </button>
  )
}
