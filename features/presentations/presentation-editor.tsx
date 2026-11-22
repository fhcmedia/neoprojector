import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { Events } from "@wailsio/runtime"
import { toast } from "sonner"
import {
  ArrowLeftIcon,
  FolderOpenIcon,
  ImagePlusIcon,
  PauseIcon,
  PlayIcon,
  SparklesIcon,
} from "lucide-react"
import { Service as Presentations } from "@/bindings/neoprojector/services/presentations"
import { Button } from "@/components/button"
import { Input } from "@/components/input"
import { OptionSelect } from "@/components/option-select"
import { cn } from "@/lib/utils"
import { resolveFit, useMediaFit } from "@/lib/media-fit"
import { motionProps, type AnimKind } from "@/features/animations/variants"
import { presentationRowToSlide, type PresentationPlayback } from "@/features/live/slides"
import { dwellMs, nextIndex } from "@/features/live/presentation-nav"
import {
  presentationKeys,
  usePresentation,
  usePresentationSlides,
  useRenamePresentation,
  useReorderSlides,
  useUpdatePlayback,
} from "@/features/presentations/api"
import {
  PresentationToolbar,
  SlideControls,
  formatSeconds,
} from "@/features/presentations/presentation-controls"
import { addFilesToPresentation, pickSlideFiles } from "@/features/presentations/import-flow"
import { LibraryPicker } from "@/features/presentations/library-picker"
import { SlideMedia } from "@/features/presentations/slide-thumb"
import { useLibraryDropZone } from "@/features/schedule/library-drag"

// PresentationEditor: build a presentation from scratch — pick pictures
// and videos (library or computer, PowerPoint/PDF too), order them, choose
// which are included, how long each stays up, whether it loops and how
// slides change — with a live preview that plays the loop exactly as the
// projector will. Opened from Library → Presentations; no service needed.
// Add it to a service by dragging its tile into the schedule.

// The transitions the presentation renderer supports (services/
// presentations validTransitionKinds).
const TRANSITIONS: readonly { value: string; label: string }[] = [
  { value: "fade", label: "Fade" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-down", label: "Slide down" },
  { value: "scale", label: "Scale" },
  { value: "blur", label: "Blur" },
  { value: "none", label: "Cut (no transition)" },
]

const TRANSITION_SPEEDS: readonly { value: string; label: string }[] = [
  { value: "250", label: "Quick — 0.25 s" },
  { value: "500", label: "Normal — 0.5 s" },
  { value: "800", label: "Smooth — 0.8 s" },
  { value: "1200", label: "Slow — 1.2 s" },
  { value: "2000", label: "Very slow — 2 s" },
  { value: "3000", label: "Extra slow — 3 s" },
]

export function PresentationEditor({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: pres } = usePresentation(id)
  const { data: rows, isLoading } = usePresentationSlides(id)
  const slides = useMemo(() => (rows ?? []).map(presentationRowToSlide), [rows])
  const playback = useMemo<PresentationPlayback | null>(
    () =>
      pres
        ? {
            loop: pres.loop === 1,
            intervalMs: pres.interval_ms,
            transitionKind: pres.transition_kind,
            transitionDurationMs: pres.transition_duration_ms,
          }
        : null,
    [pres]
  )
  const rename = useRenamePresentation()
  const updatePlayback = useUpdatePlayback(id)
  const reorder = useReorderSlides(id)
  // Same framing the projector uses (Settings → Picture fit).
  const settingFit = useMediaFit()

  // Name: edit locally, save on blur / Enter.
  const [name, setName] = useState("")
  useEffect(() => {
    if (pres) setName(pres.name)
  }, [pres?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  const saveName = () => {
    const n = name.trim()
    if (pres && n && n !== pres.name) rename.mutate({ id, name: n })
    else if (pres && !n) setName(pres.name)
  }

  const savePlayback = (patch: Partial<{ transition_kind: string; transition_duration_ms: number }>) =>
    playback &&
    updatePlayback.mutate({
      loop: playback.loop,
      interval_ms: playback.intervalMs,
      transition_kind: playback.transitionKind,
      transition_duration_ms: playback.transitionDurationMs,
      ...patch,
    })

  // Adding slides.
  const [importing, setImporting] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const addFiles = async (paths: string[]) => {
    if (paths.length === 0 || importing) return
    await addFilesToPresentation(qc, id, paths, setImporting)
  }
  const addMedia = async (ids: number[]) => {
    for (const mid of ids) await Presentations.AddSlide(id, mid)
    await qc.invalidateQueries({ queryKey: presentationKeys.slides(id) })
    if (ids.length > 1) toast.success(`Added ${ids.length} slides`)
  }
  // Files dropped from Explorer anywhere on the editor.
  const dropTarget = `presentation-editor:${id}`
  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles
  useEffect(() => {
    const off = Events.On("media:files-dropped", (e: { data?: { target_id?: string; paths?: string[] } }) => {
      if (e?.data?.target_id !== dropTarget) return
      void addFilesRef.current(e.data.paths ?? [])
    })
    return () => {
      off?.()
    }
  }, [dropTarget])
  // Library tiles dragged in (pictures/videos only).
  const libraryDrop = useLibraryDropZone((drag) => {
    if (drag.type === "media") void addMedia([drag.id])
    else toast.info("Drag pictures or videos from the Media tab into a presentation")
  })

  // Preview + loop playback, as the projector plays it.
  const [current, setCurrent] = useState(0)
  const [playing, setPlaying] = useState(false)
  const cur = Math.min(current, Math.max(0, slides.length - 1))
  const shown = slides[cur]
  useEffect(() => {
    if (!playing || !playback || slides.length === 0) return
    const t = window.setTimeout(() => {
      const n = nextIndex(slides, cur, true)
      if (n < 0) setPlaying(false)
      else setCurrent(n)
    }, dwellMs(slides[cur], playback.intervalMs))
    return () => window.clearTimeout(t)
  }, [playing, cur, slides, playback])
  // Starting playback on an excluded slide jumps to an included one.
  useEffect(() => {
    if (playing && shown?.excluded) {
      const n = nextIndex(slides, cur, true)
      if (n >= 0) setCurrent(n)
    }
  }, [playing, shown, slides, cur])

  // Drag to reorder: the other slides move aside while dragging and the
  // slide lands exactly where it's dropped. The new order shows at once
  // (cache updated first) and saves in the background.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id || !rows) return
    const from = rows.findIndex((r) => r.id === active.id)
    const to = rows.findIndex((r) => r.id === over.id)
    if (from < 0 || to < 0) return
    const next = arrayMove(rows, from, to)
    qc.setQueryData(presentationKeys.slides(id), next)
    // Keep the preview on the slide it was showing.
    const shownId = slides[cur]?.presentationSlideId
    const at = next.findIndex((r) => r.id === shownId)
    if (at >= 0) setCurrent(at)
    reorder.mutate(next.map((r) => r.id))
  }

  const included = slides.filter((s) => !s.excluded).length
  const totalMs = slides
    .filter((s) => !s.excluded)
    .reduce((sum, s) => sum + dwellMs(s, playback?.intervalMs ?? 5000), 0)
  const transitionKind = (playback?.transitionKind || "fade") as AnimKind
  const transitionMs = playback?.transitionDurationMs ?? 500

  return (
    <div
      data-file-drop-target={dropTarget}
      {...libraryDrop.props}
      className={cn(
        "flex h-full flex-col overflow-hidden bg-background [&.file-drop-target-active]:bg-foreground/[0.04]",
        libraryDrop.hover && "bg-foreground/[0.04]"
      )}
    >
      {/* Header: back, name, add. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2 py-1.5">
        <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close presentation editor">
          <ArrowLeftIcon className="size-4" />
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          }}
          aria-label="Presentation name"
          className="h-8 max-w-sm text-sm font-medium"
        />
        <span className="text-[11px] text-muted-foreground">
          {slides.length} slide{slides.length === 1 ? "" : "s"}
          {playback?.loop && included > 0 ? ` · loop ${formatSeconds(totalMs)}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
            <ImagePlusIcon className="size-3.5" />
            From library
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!importing}
            onClick={() => void pickSlideFiles().then(addFiles)}
          >
            <FolderOpenIcon className="size-3.5" />
            {importing ?? "From computer"}
          </Button>
        </div>
      </div>

      {/* Loop / timing / transition settings. */}
      <PresentationToolbar
        presentationId={id}
        playback={playback}
        slides={slides}
        importing={importing}
        onAddFiles={() => void pickSlideFiles().then(addFiles)}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/40 px-2 py-1.5 text-xs">
        <SparklesIcon className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Transition</span>
        <OptionSelect
          value={playback?.transitionKind || "fade"}
          options={TRANSITIONS}
          onChange={(v) => savePlayback({ transition_kind: v })}
          ariaLabel="Transition style"
          className="w-40"
        />
        <OptionSelect
          value={String(
            TRANSITION_SPEEDS.some((t) => Number(t.value) === transitionMs) ? transitionMs : 500
          )}
          options={TRANSITION_SPEEDS}
          onChange={(v) => savePlayback({ transition_duration_ms: Number(v) })}
          ariaLabel="Transition speed"
          className="w-40"
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* Preview */}
        {slides.length > 0 && (
          <div className="flex flex-col gap-2">
            {/* Sized to leave room for the slide strip below. */}
            <div className="relative mx-auto aspect-video w-full max-w-[min(42rem,calc((100vh-30rem)*16/9))] min-w-64 shrink-0 overflow-hidden rounded-md bg-black">
              <AnimatePresence initial={false}>
                {shown && (
                  <motion.div
                    key={`${shown.presentationSlideId}-${cur}`}
                    className="absolute inset-0"
                    {...motionProps(transitionKind, transitionMs)}
                  >
                    <SlideMedia
                      mediaId={shown.fill.media!.mediaId}
                      fit={resolveFit(shown.fill.media?.mode, settingFit)}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              {shown?.excluded && (
                <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
                  Skipped
                </span>
              )}
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button size="sm" variant={playing ? "default" : "outline"} onClick={() => setPlaying((p) => !p)}>
                {playing ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
                {playing ? "Stop preview" : "Play loop"}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Slide {cur + 1} of {slides.length}
                {shown ? ` · ${formatSeconds(dwellMs(shown, playback?.intervalMs ?? 5000))}` : ""}
              </span>
            </div>
          </div>
        )}

        {/* Slides */}
        {isLoading ? (
          <div className="grid h-32 place-items-center text-xs text-muted-foreground/60">Loading…</div>
        ) : slides.length === 0 ? (
          <div className="m-auto flex max-w-md flex-col items-center gap-3 rounded-md border border-dashed border-border/60 px-6 py-10 text-center">
            <div className="text-sm">No slides yet</div>
            <div className="text-xs text-muted-foreground">
              Pick pictures and videos from your library, or add files from
              your computer (PowerPoint and PDF become one slide per page).
              You can also drop files or Media tiles here.
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setPickerOpen(true)}>
                <ImagePlusIcon className="size-3.5" />
                From library
              </Button>
              <Button size="sm" variant="outline" disabled={!!importing} onClick={() => void pickSlideFiles().then(addFiles)}>
                <FolderOpenIcon className="size-3.5" />
                From computer
              </Button>
            </div>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={slides.map((s) => s.presentationSlideId!)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
            {slides.map((slide, idx) => {
              const sid = slide.presentationSlideId!
              return (
                <SortableSlide
                  key={sid}
                  id={sid}
                  controls={
                    <SlideControls
                      slide={slide}
                      presentationId={id}
                      intervalMs={playback?.intervalMs ?? 5000}
                    />
                  }
                >
                  <button
                    type="button"
                    onClick={() => setCurrent(idx)}
                    className={cn(
                      "relative aspect-video w-full cursor-grab overflow-hidden rounded bg-black transition-shadow active:cursor-grabbing",
                      idx === cur ? "ring-2 ring-sky-400" : "hover:ring-1 hover:ring-border",
                      slide.excluded && "opacity-40 grayscale"
                    )}
                    title="Click to preview · drag to reorder"
                  >
                    <SlideMedia
                      mediaId={slide.fill.media!.mediaId}
                      fit={resolveFit(slide.fill.media?.mode, settingFit)}
                      thumb
                    />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white/80">
                      {idx + 1}
                    </span>
                  </button>
                </SortableSlide>
              )
            })}
          </div>
          </SortableContext>
          </DndContext>
        )}
      </div>

      <LibraryPicker open={pickerOpen} onOpenChange={setPickerOpen} onAdd={(ids) => void addMedia(ids)} />
    </div>
  )
}

// SortableSlide is one tile of the editor's grid. The thumbnail is the
// drag handle (a press that moves 6px starts a drag; a plain click
// still previews); the slide's controls below it stay clickable.
function SortableSlide({
  id,
  children,
  controls,
}: {
  id: number
  children: ReactNode
  controls: ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex flex-col", isDragging && "relative z-10 opacity-80 shadow-lg")}
    >
      <div {...attributes} {...listeners} className="touch-none">
        {children}
      </div>
      {controls}
    </div>
  )
}
