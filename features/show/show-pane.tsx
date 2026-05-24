import { useCallback, useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useQueryClient } from "@tanstack/react-query"
import type {
  ListServiceItemsWithContentRow,
  Medium,
  Template,
} from "@/bindings/neoprojector/database"
import {
  useAdHocBibleSlides,
  useItemSlides,
  type Slide,
} from "@/features/live/slides"
import { useLive } from "@/features/live/live-context"
import { useDisplays } from "@/features/displays/api"
import { useTemplates } from "@/features/library/templates-api"
import { parseTemplateBody, type SlotName } from "@/features/templates/types"
import {
  PlayIcon,
  PauseIcon,
  RepeatIcon,
  Volume2Icon,
  VolumeXIcon,
  RotateCcwIcon,
} from "lucide-react"
import { useShowTemplate } from "@/features/show/use-show-template"
import { ScaledTemplate } from "@/features/templates/renderer"
import { songSectionType } from "@/features/songs/section-types"
import { cn } from "@/lib/utils"

// Per-template minimum fontSize. Single number per template applied
// uniformly to every fitToBox box across every slide in the active
// item — primary/secondary/tertiary translation boxes all render at
// the same size on every verse.
type TemplateMins = { [templateId: number]: number }

// AdHocBibleRef: a bible range typed into the library search and
// pushed live via Enter. Owns the show pane while set, displacing
// whatever schedule item was previously previewed so the operator
// can navigate the typed range with arrow keys.
export type AdHocBibleRef = {
  book: string
  bookLabel: string
  chapter: number
  verseStart: number
  verseEnd: number
}

type Props = {
  activeItemId: number | undefined
  adHocBibleRef?: AdHocBibleRef
}

// ShowPane renders each slide for the previewed source as a 16:9
// thumbnail using the audience-display template binding. Source is
// either a schedule item (clicked in the schedule) or an ad-hoc
// bible range (typed in the library + Enter).
export function ShowPane({ activeItemId, adHocBibleRef }: Props) {
  const qc = useQueryClient()

  // Subscribe to schedule items cache updates so a song/title/label edit
  // refreshes the previewed row without waiting for an unmount/remount.
  const [cacheTick, setCacheTick] = useState(0)
  useEffect(() => {
    const unsub = qc.getQueryCache().subscribe((evt) => {
      const key = evt.query.queryKey
      if (Array.isArray(key) && key[0] === "schedule" && key[1] === "items") {
        setCacheTick((t) => t + 1)
      }
    })
    return unsub
  }, [qc])

  const item = useMemo<ListServiceItemsWithContentRow | null>(() => {
    if (adHocBibleRef !== undefined) return null
    if (activeItemId === undefined) return null
    const cached = qc.getQueriesData<ListServiceItemsWithContentRow[]>({
      queryKey: ["schedule", "items"],
    })
    for (const [, data] of cached) {
      if (!data) continue
      const found = data.find((i) => i.id === activeItemId)
      if (found) return found
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, activeItemId, adHocBibleRef, cacheTick])

  const itemSlides = useItemSlides(item)
  const adHocSlides = useAdHocBibleSlides(
    adHocBibleRef?.book,
    adHocBibleRef?.bookLabel ?? "",
    adHocBibleRef?.chapter,
    adHocBibleRef?.verseStart,
    adHocBibleRef?.verseEnd
  )

  const slides = adHocBibleRef ? adHocSlides.slides : itemSlides.slides
  const isLoading = adHocBibleRef ? adHocSlides.isLoading : itemSlides.isLoading
  // playback is set only when the current item is a presentation —
  // drives auto-advance below and broadcasts the per-presentation
  // transition to audience output.
  const playback = adHocBibleRef ? null : itemSlides.playback

  // sourceItemId is the live-state correlator: schedule items use
  // their row id; ad-hoc bible uses null. Keeping these distinct
  // means click-to-toggle works correctly in either mode.
  const sourceItemId: number | null = item ? item.id : null

  const { live, setLive, isLive, registerNavigators } = useLive()
  const { data: displays } = useDisplays()
  const { data: allTemplates } = useTemplates()

  // Uniform-fit pass, scoped per template. Lower-thirds (small box)
  // and two-translations (medium box) have different floors; they
  // must not bleed into each other. Within a template, every fitToBox
  // box (across every slide) folds into ONE minimum — so primary /
  // secondary / tertiary translations always render at the same
  // size on every verse.
  //
  // Reset whenever the source changes — old mins shouldn't carry
  // across items.
  const [templateMins, setTemplateMins] = useState<TemplateMins>({})
  const fitScopeKey = adHocBibleRef
    ? `adhoc-${adHocBibleRef.book}-${adHocBibleRef.chapter}-${adHocBibleRef.verseStart}-${adHocBibleRef.verseEnd}`
    : `item-${sourceItemId ?? "none"}`
  useEffect(() => {
    setTemplateMins({})
  }, [fitScopeKey])

  // reportFit ignores the slot — every fitToBox box folds into the
  // template's single minimum. Slot is kept in the callback signature
  // for diagnostic logging only.
  const reportFit = useCallback(
    (templateId: number, _slot: SlotName, fontSize: number) => {
      setTemplateMins((prev) => {
        const existing = prev[templateId]
        if (existing !== undefined && existing <= fontSize) return prev
        return { ...prev, [templateId]: fontSize }
      })
    },
    []
  )

  // Re-broadcast when templateMins shrinks during an active live
  // slide. Without this, the first click's broadcast captures whatever
  // mins exist at that instant (possibly incomplete — only some tiles
  // have measured yet), and each audience locks to that snapshot.
  // Later reports lower the mins but the broadcast doesn't follow.
  useEffect(() => {
    if (!live) return
    if (live.sourceItemId !== sourceItemId) return
    const current = live.fontSizeOverrideByTemplate ?? {}
    if (templateMinsEqual(current, templateMins)) return
    setLive({ ...live, fontSizeOverrideByTemplate: templateMins })
  }, [templateMins, live, sourceItemId, setLive])

  // Auto-broadcast the first slide when an ad-hoc bible reference
  // arrives and its verses have resolved. Without this the operator
  // would have to click into the show pane after every Enter —
  // defeating the keystroke-fluency the typed-ref flow is for.
  // Re-runs only when the ref itself changes (keyed on the range
  // so re-typing the same range doesn't double-broadcast).
  const adHocKey = adHocBibleRef
    ? `${adHocBibleRef.book}-${adHocBibleRef.chapter}-${adHocBibleRef.verseStart}-${adHocBibleRef.verseEnd}`
    : null
  useEffect(() => {
    if (!adHocBibleRef) return
    if (adHocSlides.isLoading) return
    const first = adHocSlides.slides[0]
    if (!first) return
    setLive({
      kind: first.kind,
      sourceItemId: null,
      slideIndex: 0,
      fill: first.fill,
      fontSizeOverrideByTemplate: templateMins,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adHocKey, adHocSlides.isLoading, templateMins])

  // Register arrow-key navigators that walk this source's slide
  // list. Re-registered on every slide-list change so the closure
  // captures the current list. The keybind hook calls the latest
  // registration via a ref, so no consumer re-renders.
  useEffect(() => {
    function liveIndex(): number {
      return slides.findIndex((s, i) => isLive(s.kind, sourceItemId, i))
    }
    function setIndex(idx: number) {
      const s = slides[idx]
      if (!s) return
      setLive({
        kind: s.kind,
        sourceItemId,
        slideIndex: idx,
        fill: s.fill,
        fontSizeOverrideByTemplate: templateMins,
        transitionKind: playback?.transitionKind,
        transitionDurationMs: playback?.transitionDurationMs,
      })
    }
    registerNavigators({
      next: () => {
        const cur = liveIndex()
        if (cur < 0) {
          if (slides.length > 0) setIndex(0)
          return
        }
        // Presentations wrap on next so the loop runs forever; other
        // kinds stop at the end (the operator is driving manually).
        if (cur + 1 < slides.length) {
          setIndex(cur + 1)
        } else if (playback?.loop) {
          setIndex(0)
        }
      },
      prev: () => {
        const cur = liveIndex()
        if (cur > 0) setIndex(cur - 1)
      },
    })
  }, [
    slides,
    sourceItemId,
    isLive,
    setLive,
    registerNavigators,
    templateMins,
    playback,
  ])

  // Auto-advance loop. Runs ONLY when a presentation item is live
  // AND its `loop` setting is on AND there's more than one slide.
  // The timer ticks every playback.intervalMs and calls the same
  // setIndex used by arrow keys — so loop + manual navigation share
  // one code path. Cleared whenever any of the deps change (the
  // interval is restarted from scratch on every dep change, which
  // means hitting Next manually resets the dwell — the operator's
  // last action is the new anchor, never a half-elapsed dwell).
  useEffect(() => {
    if (!playback || !playback.loop) return
    if (slides.length <= 1) return
    if (!live || live.sourceItemId !== sourceItemId) return
    const id = window.setInterval(() => {
      const cur = slides.findIndex((s, i) =>
        isLive(s.kind, sourceItemId, i)
      )
      const next = cur < 0 ? 0 : (cur + 1) % slides.length
      const s = slides[next]
      if (!s) return
      setLive({
        kind: s.kind,
        sourceItemId,
        slideIndex: next,
        fill: s.fill,
        fontSizeOverrideByTemplate: templateMins,
        transitionKind: playback.transitionKind,
        transitionDurationMs: playback.transitionDurationMs,
      })
    }, Math.max(250, playback.intervalMs))
    return () => window.clearInterval(id)
  }, [
    playback,
    slides,
    live,
    sourceItemId,
    isLive,
    setLive,
    templateMins,
  ])

  // Pick the template per-kind from the first enabled display. Both
  // hooks always run (React rule); we read the one matching the
  // current item's kind below.
  const bibleTemplate = useShowTemplate("bible")
  const songTemplate = useShowTemplate("song")

  function templateForSlide(slide: Slide): Template | undefined {
    if (slide.kind === "bible") return bibleTemplate
    if (slide.kind === "song") return songTemplate
    return undefined
  }

  // Collect every template id we need to measure across slides for
  // the current slide kind. ONLY templates with crossSlideUniform=true
  // qualify — those are the ones (lower thirds) that need a single
  // fontSize across every verse. Audience templates self-coordinate
  // per-slide inside their canvas; they don't need a cross-slide
  // measurement pass at all.
  const slideKind = slides[0]?.kind
  const measurementTemplates = useMemo<Template[]>(() => {
    if (!allTemplates || !slideKind || slideKind === "media") return []
    const visibleId =
      slideKind === "bible"
        ? bibleTemplate?.id
        : slideKind === "song"
          ? songTemplate?.id
          : undefined
    const ids = new Set<number>()
    if (visibleId !== undefined) ids.add(visibleId)
    for (const d of displays ?? []) {
      if (d.enabled === 0) continue
      const binding =
        slideKind === "bible" ? d.bible_template_id : d.song_template_id
      if (binding?.Valid) ids.add(binding.Int64)
    }
    return Array.from(ids)
      .map((id) => allTemplates.find((t) => t.id === id))
      .filter((t): t is Template => !!t)
      .filter((t) => parseTemplateBody(t.data_json).crossSlideUniform === true)
  }, [allTemplates, displays, bibleTemplate, songTemplate, slideKind])

  // Empty state copy depends on which source is active so the
  // operator sees the right next-step prompt.
  const emptyPrompt = adHocBibleRef
    ? "Type a reference in the bible library — Enter to broadcast."
    : "Pick an item in the schedule to preview"

  return (
    <div className="relative h-full w-full bg-background">
      <div className="pointer-events-none absolute left-3 top-2 z-10 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        Show
      </div>
      <div className="flex h-full flex-col pt-7">
        <AnimatePresence mode="wait" initial={false}>
          {!item && !adHocBibleRef ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-1 items-center justify-center"
            >
              <Empty>{emptyPrompt}</Empty>
            </motion.div>
          ) : isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-1 items-center justify-center"
            >
              <Empty muted>Loading…</Empty>
            </motion.div>
          ) : slides.length === 0 ? (
            <motion.div
              key="no-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-1 items-center justify-center"
            >
              <Empty>This item has no content yet</Empty>
            </motion.div>
          ) : item && item.kind === "media" ? (
            <motion.div
              key={`media-${item.id}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              className="flex flex-1 flex-col"
            >
              <MediaPreview item={item} onSend={() => {
                const slide = slides[0]
                if (!slide) return
                setLive({ kind: slide.kind as "media", sourceItemId: item.id, slideIndex: 0, fill: slide.fill })
              }} />
            </motion.div>
          ) : (
            <motion.div
              key={`slides-${activeItemId ?? "adhoc"}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              className="grid flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 overflow-y-auto p-2 content-start"
            >
              {slides.map((slide, idx) => {
                const active = isLive(slide.kind, sourceItemId, idx)
                const tmpl = templateForSlide(slide)
                const tmplBody = tmpl
                  ? parseTemplateBody(tmpl.data_json)
                  : undefined
                const tmplCrossSlide =
                  tmplBody?.crossSlideUniform === true
                const tmplOverride =
                  tmpl && tmplCrossSlide ? templateMins[tmpl.id] : undefined
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      duration: 0.18,
                      ease: [0.32, 0.72, 0, 1],
                      delay: Math.min(idx * 0.03, 0.18),
                    }}
                  >
                    <SlideTile
                      slide={slide}
                      template={tmpl}
                      active={active}
                      fontSizeOverride={tmplOverride}
                      onFitComputed={(slot, fontSize) => {
                        // Only forward fits for templates that opted
                        // into cross-slide uniform. Per-slide-only
                        // templates handle their own cross-box unify
                        // inside TemplateCanvas — no broadcast needed.
                        if (!tmpl || !tmplCrossSlide) return
                        reportFit(tmpl.id, slot, fontSize)
                      }}
                      onClick={() => {
                        if (active) {
                          setLive(null)
                          return
                        }
                        setLive({
                          kind: slide.kind,
                          sourceItemId,
                          slideIndex: idx,
                          fill: slide.fill,
                          fontSizeOverrideByTemplate: templateMins,
                          transitionKind: playback?.transitionKind,
                          transitionDurationMs: playback?.transitionDurationMs,
                        })
                      }}
                    />
                  </motion.div>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Off-screen measurement layer for every OTHER template a
            display might use. The visible tiles only measure against
            the show pane's primary template; without this hidden pass,
            an audience window bound to a different template would
            never get its own per-slot minimum and would fall back to
            no override (potentially cutting). Each hidden ScaledTemplate
            renders at the template's native viewport size so the box
            layout matches what the audience window will see — same
            measurements, same floor decision. */}
        {measurementTemplates.length > 0 && slides.length > 0 && (
          <div
            aria-hidden
            style={{
              position: "fixed",
              left: -100000,
              top: -100000,
              pointerEvents: "none",
              opacity: 0,
            }}
          >
            {measurementTemplates.map((tmpl) =>
              slides.map((slide, idx) => (
                <div
                  key={`${tmpl.id}-${idx}`}
                  style={{
                    width: tmpl.viewport_w,
                    height: tmpl.viewport_h,
                  }}
                >
                  <ScaledTemplate
                    template={tmpl}
                    fill={slide.fill}
                    measure
                    onFitComputed={(slot, fontSize) =>
                      reportFit(tmpl.id, slot, fontSize)
                    }
                  />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Shallow equality for the per-template single-value map. Used by the
// re-broadcast effect to avoid infinite setLive loops when nothing has
// actually changed (the audience output's BoxRenderer would still
// re-run if we passed a fresh object reference identical in content).
function templateMinsEqual(a: TemplateMins, b: TemplateMins): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (a[Number(k)] !== b[Number(k)]) return false
  }
  return true
}

function SlideTile({
  slide,
  template,
  active,
  fontSizeOverride,
  onFitComputed,
  onClick,
}: {
  slide: Slide
  template: Template | undefined
  active: boolean
  fontSizeOverride: number | undefined
  onFitComputed: (slot: SlotName, fontSize: number) => void
  onClick: () => void
}) {
  const bottomAccent =
    slide.kind === "song" && slide.sectionType
      ? songSectionType(slide.sectionType).swatch
      : null
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative block aspect-video w-full overflow-hidden rounded bg-muted/30 transition-all duration-150 hover:ring-1 hover:ring-border"
    >
      {template ? (
        <ScaledTemplate
          template={template}
          fill={slide.fill}
          measure
          fontSizeOverride={fontSizeOverride}
          onFitComputed={onFitComputed}
          className="absolute inset-0 h-full w-full"
        />
      ) : slide.fill.media ? (
        // Media slides (single-media items and presentation slides)
        // don't have a templated text layer — render the media bytes
        // directly as the tile background, same approach the audience
        // output uses when no template binding exists for the kind.
        <MediaThumb mediaId={slide.fill.media.mediaId} />
      ) : (
        <div className="grid h-full w-full place-items-center text-[10px] text-muted-foreground/40">
          No template
        </div>
      )}
      {bottomAccent && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-0.5",
            bottomAccent
          )}
        />
      )}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 text-[10px] transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <span
          className={cn(
            "truncate uppercase tracking-wider",
            active ? "text-emerald-400" : "text-white/80"
          )}
        >
          {slide.caption}
        </span>
        {active && (
          <span className="shrink-0 uppercase tracking-wider text-emerald-400">
            Live
          </span>
        )}
      </div>
      <AnimatePresence>
        {active && (
          <motion.div
            key="active-ring"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute inset-0 rounded ring-2 ring-inset ring-emerald-500"
          />
        )}
      </AnimatePresence>
    </button>
  )
}

// MediaThumb — tiny background renderer for media slides in show
// pane tiles. Picks the right element (<img> for image media,
// muted <video> for video media) by checking the media list cache.
// Falls back to a placeholder icon if the media row is missing from
// the cache (deleted, or query hasn't loaded yet).
function MediaThumb({ mediaId }: { mediaId: number }) {
  const qc = useQueryClient()
  const medium = (qc.getQueryData<Medium[]>(["media", "list"]) ?? []).find(
    (m) => m.id === mediaId
  )
  if (!medium) {
    return (
      <div className="grid h-full w-full place-items-center bg-muted/30 text-muted-foreground/40">
        <PlayIcon className="size-5 opacity-60" />
      </div>
    )
  }
  if (medium.type === "image") {
    return (
      <img
        src={`/media-asset/${mediaId}`}
        alt={medium.title || ""}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
      />
    )
  }
  if (medium.type === "video") {
    return (
      <video
        src={`/media-asset/${mediaId}`}
        className="absolute inset-0 h-full w-full object-cover"
        preload="metadata"
        muted
      />
    )
  }
  return (
    <div className="grid h-full w-full place-items-center bg-muted/30 text-muted-foreground/40">
      <PlayIcon className="size-5 opacity-60" />
    </div>
  )
}

function MediaPreview({
  item,
  onSend,
}: {
  item: ListServiceItemsWithContentRow
  onSend: () => void
}) {
  const mediaId = item.media_id
  const qc = useQueryClient()
  const medium = (qc.getQueryData<Medium[]>(["media", "list"]) ?? []).find(
    (m) => m.id === mediaId
  )
  const isVideo = medium?.type === "video"
  const isImage = medium?.type === "image"
  const isAudio = medium?.type === "audio"

  // Operator-side controls drive the live state. When this media is
  // live (live.fill.media points at this id), the buttons reflect and
  // mutate the shared playback fields; the output windows pick the
  // change up on the next PushLive.
  const { live, setMediaPlayback, restartMedia } = useLive()
  const liveMedia =
    live?.kind === "media" && live.fill.media?.mediaId === mediaId
      ? live.fill.media
      : null
  const isLive = !!liveMedia
  const playing = liveMedia?.playing ?? false
  const looping = liveMedia?.loop ?? false
  const muted = liveMedia?.muted ?? false

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
      {/* Click anywhere on the preview surface sends the media to live.
          Native <video>/<audio> controls live INSIDE the preview and
          stop propagation so scrubbing doesn't also trigger a send. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSend()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onSend()
          }
        }}
        className={cn(
          "group relative flex-1 cursor-pointer overflow-hidden rounded-md bg-black transition-shadow",
          isLive
            ? "ring-2 ring-inset ring-emerald-500/70"
            : "hover:ring-2 hover:ring-inset hover:ring-border"
        )}
        aria-label={isLive ? "Already live — click to re-send" : "Click to send live"}
      >
        {isImage && mediaId ? (
          <img
            src={`/media-asset/${mediaId}`}
            alt={medium?.title || item.label || "Media"}
            className="h-full w-full object-contain"
          />
        ) : isVideo && mediaId ? (
          // Local preview keeps native controls so the operator can
          // scrub independently of what the audience sees. The live
          // output is the controlled surface — this is the monitor.
          // onClick stopPropagation so scrubber drags don't trigger
          // the outer "click to send live" handler.
          <video
            src={`/media-asset/${mediaId}`}
            controls
            muted
            className="h-full w-full"
            onClick={(e) => e.stopPropagation()}
          />
        ) : isAudio && mediaId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground/70">
            <Volume2Icon className="size-10 opacity-60" />
            <audio
              src={`/media-asset/${mediaId}`}
              controls
              className="w-3/4"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : (
          <div className="grid h-full place-items-center text-xs text-muted-foreground/40">
            {item.label || "Media"}
          </div>
        )}
        {!isLive && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/70 to-transparent py-2 text-[11px] uppercase tracking-wider text-white/90 opacity-0 transition-opacity group-hover:opacity-100">
            Click to send live
          </div>
        )}
      </div>

      {/* Control bar — playback controls only matter for video/audio. */}
      {(isVideo || isAudio) && isLive ? (
        <div className="flex items-center gap-1 rounded-md border border-border/40 bg-muted/20 px-2 py-1.5">
          <ControlButton
            label={playing ? "Pause" : "Play"}
            onClick={() => setMediaPlayback({ playing: !playing })}
          >
            {playing ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
          </ControlButton>
          <ControlButton
            label="Restart from beginning"
            onClick={restartMedia}
          >
            <RotateCcwIcon className="size-3.5" />
          </ControlButton>
          <ControlButton
            label={looping ? "Looping" : "Loop"}
            active={looping}
            onClick={() => setMediaPlayback({ loop: !looping })}
          >
            <RepeatIcon className="size-3.5" />
          </ControlButton>
          <ControlButton
            label={muted ? "Unmute output" : "Mute output"}
            active={muted}
            onClick={() => setMediaPlayback({ muted: !muted })}
          >
            {muted ? <VolumeXIcon className="size-3.5" /> : <Volume2Icon className="size-3.5" />}
          </ControlButton>
          <div className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Live
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onSend}
        className="flex items-center justify-center gap-2 rounded-md bg-foreground/10 px-3 py-2 text-xs font-medium transition-colors hover:bg-foreground/15"
      >
        <PlayIcon className="size-3" />
        {isLive ? "Re-send to Live" : "Send to Live"}
      </button>
    </div>
  )
}

function ControlButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded transition-colors",
        active
          ? "bg-foreground/15 text-foreground"
          : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function Empty({
  children,
  muted,
}: {
  children: React.ReactNode
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        "grid flex-1 place-items-center px-4 text-center text-xs",
        muted ? "text-muted-foreground/40" : "text-muted-foreground/60"
      )}
    >
      {children}
    </div>
  )
}
