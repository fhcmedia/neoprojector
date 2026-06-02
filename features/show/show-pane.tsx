import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useQueryClient } from "@tanstack/react-query"
import { Events } from "@wailsio/runtime"
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
import { SongShowView, BibleShowView } from "@/features/show/show-content-views"
import { songSectionType } from "@/features/songs/section-types"
import { cn } from "@/lib/utils"
import {
  useAddSlide,
  useReorderSlides,
} from "@/features/presentations/api"
import { useUpdateBibleItem } from "@/features/schedule/api"
import { useBibleEdit } from "@/features/schedule/bible-edit-context"
import { useBibleTranslations } from "@/hooks/use-bible-translations"
import { Service as Media } from "@/bindings/neoprojector/services/media"

// Drop target tag that lets the operator drag external image files
// directly onto the show pane while a presentation is active. The Go
// side reports the element-id on file drop; we filter the broadcast
// `media:files-dropped` event by this value and import + append in
// one step.
const SHOW_PANE_DROP_TARGET = "show-pane-presentation"
const MEDIA_DROP_EVENT = "media:files-dropped"
type MediaDropPayload = {
  paths?: string[]
  target_id?: string
}

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
  // The verse that should be LIVE within the range. Picking verse 18
  // of a 16-18 selection puts 18 live (not the first verse). Defaults
  // to verseStart when unset.
  liveVerse?: number
  // The "Scripture from Library" row this ref was appended to, when the
  // search bar / drawer pushed it live. Lets the live state correlate to
  // that schedule row so it highlights as live in the schedule.
  itemId?: number
}

type Props = {
  activeItemId: number | undefined
  adHocBibleRef?: AdHocBibleRef
  // Lets the show pane extend the ad-hoc range (e.g. clicking the
  // next-verse preview grows the passage and goes live to it). Same
  // handler the library uses to submit a typed reference.
  onAdHocBibleRef?: (ref: AdHocBibleRef) => void
  // Fired when the operator navigates bible FROM the show pane (verse
  // click, arrows, preview). The library uses it to auto-collapse the
  // now-redundant bible drawer. Not fired for drawer-driven changes.
  onShowBibleNav?: () => void
}

// ShowPane renders each slide for the previewed source as a 16:9
// thumbnail using the audience-display template binding. Source is
// either a schedule item (clicked in the schedule) or an ad-hoc
// bible range (typed in the library + Enter).
export function ShowPane({
  activeItemId,
  adHocBibleRef,
  onAdHocBibleRef,
  onShowBibleNav,
}: Props) {
  const qc = useQueryClient()

  // Resolved from cache every render (not memoized) so an in-place
  // verse-range edit reflects in the preview immediately — a memo with
  // stable deps would keep returning the pre-edit row. The found object
  // ref stays stable while the cache is unchanged, so the item-keyed
  // effects below don't thrash.
  const item = ((): ListServiceItemsWithContentRow | null => {
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
  })()

  // While a bible row is being edited in the drawer, preview its
  // TENTATIVE range (the edit hasn't been persisted yet). Overriding
  // here — rather than waiting for a cache write — is what makes the
  // preview track each pick live. Only the row currently under edit is
  // affected; everything else previews its saved range.
  const { target: bibleEditTarget, setRange: setBibleEditRange } = useBibleEdit()
  const previewItem: ListServiceItemsWithContentRow | null =
    item &&
    item.kind === "bible" &&
    bibleEditTarget?.itemId === item.id
      ? {
          ...item,
          verse_start: bibleEditTarget.verseStart,
          verse_end: bibleEditTarget.verseEnd,
        }
      : item

  const itemSlides = useItemSlides(previewItem)
  const adHocSlides = useAdHocBibleSlides(
    adHocBibleRef?.book,
    adHocBibleRef?.bookLabel ?? "",
    adHocBibleRef?.chapter,
    adHocBibleRef?.verseStart,
    adHocBibleRef?.verseEnd
  )

  const slides = adHocBibleRef ? adHocSlides.slides : itemSlides.slides
  const isLoading = adHocBibleRef ? adHocSlides.isLoading : itemSlides.isLoading
  // Read-ahead verse (the one just past the range), shown dimmed in the
  // bible view when the next-verse-preview setting is on. peekBack is the
  // verse just before the range — only shown once the operator arms it
  // by pressing up (rarely needed, so it stays out of the way).
  const peek = adHocBibleRef ? adHocSlides.peek : itemSlides.peek
  const peekBack = adHocBibleRef ? adHocSlides.peekBack : itemSlides.peekBack
  // playback is set only when the current item is a presentation —
  // drives auto-advance below and broadcasts the per-presentation
  // transition to audience output.
  const playback = adHocBibleRef ? null : itemSlides.playback

  // sourceItemId is the live-state correlator: schedule items use their
  // row id. An ad-hoc bible ref carries the row it was appended to (the
  // "Scripture from Library" inbox), so it correlates there too — that's
  // what lets the appended row highlight as live. Falls back to null only
  // when there's genuinely no backing row (no active service).
  const sourceItemId: number | null = item
    ? item.id
    : adHocBibleRef?.itemId ?? null

  // Presentation-only affordances: drag-to-reorder and external-file
  // drop both need the parent presentation's id. Zero when this item
  // isn't a presentation — the mutations stay idle in that case.
  const isPresentation =
    !!item && item.kind === "presentation" && item.presentation_id !== 0
  const presentationId = isPresentation ? item!.presentation_id : 0
  const addSlide = useAddSlide(presentationId)
  const reorderSlides = useReorderSlides(presentationId)

  // Bible-grow: pressing arrow past the end (or before the start) of
  // a single bible item's queued range extends the range by one verse
  // and lets live advance into it. Capped by the chapter's verse list
  // — we don't auto-cross chapters, since that would also change the
  // book_chapter on the schedule row and surprise the operator.
  const updateBibleItem = useUpdateBibleItem()
  const { state: bibleTranslations } = useBibleTranslations()

  const { live, setLive, isLive, registerNavigators } = useLive()

  // Latest "advance into the next/previous verse" actions. The arrow-key
  // navigators are registered in an effect defined ABOVE selectPeek
  // (const TDZ), so they reach these through refs — read at keypress
  // time, always current — instead of stale or not-yet-defined values.
  const selectPeekRef = useRef<(() => void) | null>(null)
  const selectPeekBackRef = useRef<(() => void) | null>(null)
  // Stable handle to onShowBibleNav so the nav call sites don't need it
  // in their dependency arrays (it can change identity each render).
  const onShowBibleNavRef = useRef(onShowBibleNav)
  onShowBibleNavRef.current = onShowBibleNav
  const { data: displays } = useDisplays()
  const { data: allTemplates } = useTemplates()

  // Drag-to-reorder state. Holds the presentation-slide DB id of the
  // tile currently being dragged. Reset on dragend/drop. The reorder
  // mutation reads the current slide-list order from React Query, so
  // we hand it the new id array on drop and let it persist server-
  // side. Optimistic update happens via the mutation's onSuccess
  // invalidating the slides query.
  const [dragSlideId, setDragSlideId] = useState<number | null>(null)

  // Pause auto-advance via per-tile pause click. Reset whenever the
  // source item changes — entering a new presentation shouldn't
  // inherit a paused state from the previous one.
  const [autoPaused, setAutoPaused] = useState(false)
  useEffect(() => {
    setAutoPaused(false)
  }, [sourceItemId])

  // Whether the up-direction preview (peekBack) is revealed. Off until
  // the operator presses up — going up is rare, so we keep it hidden
  // until they signal it. Reset when the source changes.
  const [upPeekArmed, setUpPeekArmed] = useState(false)
  useEffect(() => {
    setUpPeekArmed(false)
  }, [sourceItemId])

  // Listen for OS-level file drops landing on the show pane while a
  // presentation is active. Same Wails-emitted event the library uses;
  // we filter by target_id so library/show drops don't collide. Each
  // dropped file is imported into the media library and appended as a
  // new slide on the active presentation. Sequential await keeps
  // ordering deterministic — drops added in the order the user
  // dropped them.
  useEffect(() => {
    if (!isPresentation) return
    const off = Events.On(
      MEDIA_DROP_EVENT,
      async (event: { data?: MediaDropPayload }) => {
        const data = event?.data ?? {}
        if (data.target_id !== SHOW_PANE_DROP_TARGET) return
        const paths = data.paths ?? []
        if (paths.length === 0) return
        const imported = (await Media.ImportFiles(paths)) as unknown as Medium[]
        for (const m of imported) {
          await addSlide.mutateAsync(m.id)
        }
      }
    )
    return () => {
      off?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresentation, presentationId])

  // Drop one tile onto another: the dragged tile takes the target
  // tile's index, the others slide to make room. Operates on the
  // current slide list's presentation-slide ids — non-presentation
  // slides don't carry those ids, so the function is a no-op there.
  function moveDraggedBefore(targetSlideId: number) {
    if (dragSlideId === null || dragSlideId === targetSlideId) return
    const ids = slides
      .map((s) => s.presentationSlideId)
      .filter((v): v is number => typeof v === "number")
    const from = ids.indexOf(dragSlideId)
    const to = ids.indexOf(targetSlideId)
    if (from < 0 || to < 0) return
    const next = ids.slice()
    next.splice(from, 1)
    next.splice(to, 0, dragSlideId)
    reorderSlides.mutate(next)
  }

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
  // Which verse the operator just picked — goes live even when the
  // range grew around it. Falls back to the range start.
  const adHocLiveVerse = adHocBibleRef?.liveVerse ?? adHocBibleRef?.verseStart
  const adHocKey = adHocBibleRef
    ? `${adHocBibleRef.book}-${adHocBibleRef.chapter}-${adHocBibleRef.verseStart}-${adHocBibleRef.verseEnd}-${adHocLiveVerse}`
    : null
  useEffect(() => {
    if (!adHocBibleRef) return
    if (adHocSlides.isLoading) return
    // Broadcast the picked verse, not necessarily the first one — when
    // the operator builds a passage by clicking down the chapter, the
    // earlier verses stay in the list while the clicked verse goes live.
    const target = adHocLiveVerse ?? adHocBibleRef.verseStart
    let idx = adHocSlides.slides.findIndex(
      (s) => Number(s.caption.split(":").pop()) === target
    )
    if (idx < 0) idx = 0
    const slide = adHocSlides.slides[idx]
    if (!slide) return
    setLive({
      kind: slide.kind,
      sourceItemId,
      slideIndex: idx,
      fill: slide.fill,
      fontSizeOverrideByTemplate: templateMins,
      bibleRef: slide.bibleRef,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adHocKey, adHocSlides.isLoading, templateMins, sourceItemId])

  // Register arrow-key navigators that walk this source's slide
  // list. Re-registered on every slide-list change so the closure
  // captures the current list. The keybind hook calls the latest
  // registration via a ref, so no consumer re-renders.
  useEffect(() => {
    function liveIndex(): number {
      return slides.findIndex((s, i) => isLive(s.kind, sourceItemId, i))
    }
    // Compute the upcoming slide's media id so output windows can
    // preload it before the next crossfade. Only meaningful when the
    // current item is a presentation with a determinate next slide.
    function nextMediaIdAfter(idx: number): number | undefined {
      if (!playback) return undefined
      const nextIdx = playback.loop
        ? (idx + 1) % slides.length
        : idx + 1 < slides.length
          ? idx + 1
          : -1
      if (nextIdx < 0) return undefined
      return slides[nextIdx]?.fill.media?.mediaId
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
        nextMediaId: nextMediaIdAfter(idx),
        bibleRef: s.bibleRef,
      })
      if (s.kind === "bible") onShowBibleNavRef.current?.()
    }
    // Off-the-end growth (forward/back) now runs through selectPeek /
    // selectPeekBack (via refs), which grow AND go live in one press and
    // cap themselves at the chapter edge (no peek slide → no-op).
    registerNavigators({
      next: () => {
        const cur = liveIndex()
        if (cur < 0) {
          if (slides.length > 0) setIndex(0)
          return
        }
        // Presentations wrap on next so the loop runs forever; other
        // kinds stop at the end. Bible items auto-grow into the next
        // verse so the operator can keep reading without re-typing.
        if (cur + 1 < slides.length) {
          setIndex(cur + 1)
          return
        }
        if (playback?.loop) {
          setIndex(0)
          return
        }
        // Advance into the next verse — grow the passage AND go live in
        // one keypress, same as clicking the preview. selectPeek caps
        // itself at the chapter end (no next verse → no-op), and is a
        // no-op for non-bible kinds.
        selectPeekRef.current?.()
      },
      prev: () => {
        // Heading up — reveal the up-preview (kept hidden until now).
        setUpPeekArmed(true)
        const cur = liveIndex()
        if (cur > 0) {
          setIndex(cur - 1)
          return
        }
        // At the top — grow upward and go live in one press, mirroring
        // forward. Caps at verse 1 (no peekBack → no-op).
        selectPeekBackRef.current?.()
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
    item,
    qc,
    bibleTranslations.primary,
    updateBibleItem,
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
    if (autoPaused) return
    if (slides.length <= 1) return
    if (!live || live.sourceItemId !== sourceItemId) return
    const id = window.setInterval(() => {
      const cur = slides.findIndex((s, i) =>
        isLive(s.kind, sourceItemId, i)
      )
      const next = cur < 0 ? 0 : (cur + 1) % slides.length
      const s = slides[next]
      if (!s) return
      // The one AFTER `next` is what outputs need warm so the
      // FOLLOWING crossfade isn't blocked on decode. Always wraps
      // because auto-advance runs in loop mode by definition here.
      const after = (next + 1) % slides.length
      setLive({
        kind: s.kind,
        sourceItemId,
        slideIndex: next,
        fill: s.fill,
        fontSizeOverrideByTemplate: templateMins,
        transitionKind: playback.transitionKind,
        transitionDurationMs: playback.transitionDurationMs,
        nextMediaId: slides[after]?.fill.media?.mediaId,
      })
    }, Math.max(250, playback.intervalMs))
    return () => window.clearInterval(id)
  }, [
    playback,
    autoPaused,
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

  // Push the slide at idx live, or clear it if it's already live (a
  // second click on the live unit blanks output — same toggle the old
  // template tiles had). Song/bible carry no playback fields, so this
  // is the whole interaction for the text views.
  const selectSlide = useCallback(
    (idx: number) => {
      const slide = slides[idx]
      if (!slide) return
      if (isLive(slide.kind, sourceItemId, idx)) {
        setLive(null)
        return
      }
      setLive({
        kind: slide.kind,
        sourceItemId,
        slideIndex: idx,
        fill: slide.fill,
        fontSizeOverrideByTemplate: templateMins,
        bibleRef: slide.bibleRef,
      })
      if (slide.kind === "bible") onShowBibleNavRef.current?.()
    },
    [slides, sourceItemId, isLive, setLive, templateMins]
  )

  // Click the dimmed next-verse preview: grow the passage to include
  // that verse AND go live to it in one action — no separate "confirm"
  // step. Three sources, three ways to grow:
  //   - ad-hoc range  → extend the typed ref (also grows the inbox row)
  //   - bible row being edited → extend the tentative range only
  //   - plain bible item → persist the grown range, then broadcast
  const selectPeek = useCallback(() => {
    if (!peek) return
    const peekVerse = Number(peek.caption.split(":").pop())
    if (!Number.isFinite(peekVerse)) return
    onShowBibleNavRef.current?.()
    if (adHocBibleRef) {
      onAdHocBibleRef?.({
        ...adHocBibleRef,
        verseEnd: Math.max(adHocBibleRef.verseEnd, peekVerse),
        liveVerse: peekVerse,
      })
      return
    }
    if (
      item &&
      item.kind === "bible" &&
      bibleEditTarget?.itemId === item.id
    ) {
      setBibleEditRange(bibleEditTarget.verseStart, peekVerse)
      return
    }
    if (item && item.kind === "bible") {
      updateBibleItem.mutate({
        itemId: item.id,
        ref: {
          book: item.book,
          chapter: item.chapter,
          verse_start: item.verse_start,
          verse_end: peekVerse,
        },
      })
      // The grown verse appends at the end of the list — broadcast it
      // now so going live doesn't wait on the mutation round-trip.
      setLive({
        kind: "bible",
        sourceItemId,
        slideIndex: slides.length,
        fill: peek.fill,
        fontSizeOverrideByTemplate: templateMins,
        bibleRef: peek.bibleRef,
      })
    }
  }, [
    peek,
    adHocBibleRef,
    onAdHocBibleRef,
    item,
    bibleEditTarget,
    setBibleEditRange,
    updateBibleItem,
    setLive,
    sourceItemId,
    slides.length,
    templateMins,
  ])
  // Expose the latest selectPeek to the arrow-key navigators (above).
  selectPeekRef.current = selectPeek

  // Click the armed up-preview (verse just before the range): grow the
  // passage upward and go live to it, mirroring selectPeek. The grown
  // verse prepends at index 0 (existing verses shift down).
  const selectPeekBack = useCallback(() => {
    if (!peekBack) return
    const v = Number(peekBack.caption.split(":").pop())
    if (!Number.isFinite(v)) return
    onShowBibleNavRef.current?.()
    if (adHocBibleRef) {
      onAdHocBibleRef?.({
        ...adHocBibleRef,
        verseStart: Math.min(adHocBibleRef.verseStart, v),
        liveVerse: v,
      })
      return
    }
    if (
      item &&
      item.kind === "bible" &&
      bibleEditTarget?.itemId === item.id
    ) {
      setBibleEditRange(v, bibleEditTarget.verseEnd)
      return
    }
    if (item && item.kind === "bible") {
      updateBibleItem.mutate({
        itemId: item.id,
        ref: {
          book: item.book,
          chapter: item.chapter,
          verse_start: v,
          verse_end: item.verse_end,
        },
      })
      setLive({
        kind: "bible",
        sourceItemId,
        slideIndex: 0,
        fill: peekBack.fill,
        fontSizeOverrideByTemplate: templateMins,
        bibleRef: peekBack.bibleRef,
      })
    }
  }, [
    peekBack,
    adHocBibleRef,
    onAdHocBibleRef,
    item,
    bibleEditTarget,
    setBibleEditRange,
    updateBibleItem,
    setLive,
    sourceItemId,
    templateMins,
  ])
  // Expose the latest up-advance to the arrow-key navigators (above).
  selectPeekBackRef.current = selectPeekBack

  // Empty state copy depends on which source is active so the
  // operator sees the right next-step prompt.
  const emptyPrompt = adHocBibleRef
    ? "Type a reference in the bible library — Enter to broadcast."
    : "Pick an item in the schedule to preview"

  return (
    <div className="relative h-full w-full select-none bg-background">
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
          ) : slideKind === "song" ? (
            <motion.div
              key={`song-${activeItemId ?? "adhoc"}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <SongShowView
                slides={slides}
                isLiveAt={(idx) =>
                  isLive(slides[idx].kind, sourceItemId, idx)
                }
                onSelect={selectSlide}
              />
            </motion.div>
          ) : slideKind === "bible" ? (
            <motion.div
              key={`bible-${activeItemId ?? "adhoc"}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              className="flex flex-1 flex-col overflow-hidden"
            >
              <BibleShowView
                slides={slides}
                isLiveAt={(idx) =>
                  isLive(slides[idx].kind, sourceItemId, idx)
                }
                onSelect={selectSlide}
                peek={
                  bibleTranslations.nextVersePreview ? peek ?? null : null
                }
                onPeekSelect={selectPeek}
                peekBack={
                  bibleTranslations.nextVersePreview && upPeekArmed
                    ? peekBack ?? null
                    : null
                }
                onPeekBackSelect={selectPeekBack}
              />
            </motion.div>
          ) : (
            <motion.div
              key={`slides-${activeItemId ?? "adhoc"}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              // Drop-target marker is only meaningful for presentations.
              // The Go side reads the attribute to tag the emitted
              // event; if absent, the drop is treated as targetless
              // (and the show-pane listener ignores it).
              {...(isPresentation
                ? { "data-file-drop-target": SHOW_PANE_DROP_TARGET }
                : {})}
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
                // Drag-to-reorder only applies to presentation slides
                // (only they have a stable DB id we can re-order on).
                // Hover-pause icon shows only while loop auto-advance
                // is currently running — pointless on single-frame or
                // manual playlists.
                const draggableId =
                  isPresentation && slide.presentationSlideId !== undefined
                    ? slide.presentationSlideId
                    : null
                const showPauseAffordance =
                  isPresentation && playback?.loop === true
                return (
                  <motion.div
                    key={
                      draggableId !== null
                        ? `slide-${draggableId}`
                        : idx
                    }
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{
                      duration: 0.18,
                      ease: [0.32, 0.72, 0, 1],
                      delay: Math.min(idx * 0.03, 0.18),
                    }}
                    {...(draggableId !== null
                      ? {
                          draggable: true,
                          onDragStart: () => setDragSlideId(draggableId),
                          onDragEnd: () => setDragSlideId(null),
                          onDragOver: (e: ReactDragEvent) => {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = "move"
                          },
                          onDrop: (e: ReactDragEvent) => {
                            e.preventDefault()
                            moveDraggedBefore(draggableId)
                            setDragSlideId(null)
                          },
                          className: cn(
                            "relative transition-opacity",
                            dragSlideId === draggableId && "opacity-50"
                          ),
                        }
                      : {})}
                  >
                    <SlideTile
                      slide={slide}
                      template={tmpl}
                      active={active}
                      fontSizeOverride={tmplOverride}
                      pausedAffordance={
                        showPauseAffordance
                          ? { paused: autoPaused, onToggle: () => setAutoPaused((p) => !p) }
                          : undefined
                      }
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
                        // Preload the next slide's media so the
                        // subsequent crossfade has its bytes warm in
                        // every output window. Loop-mode wraps;
                        // manual-mode just looks one ahead.
                        const nextIdx = playback?.loop
                          ? (idx + 1) % slides.length
                          : idx + 1 < slides.length
                            ? idx + 1
                            : -1
                        const nextMediaId =
                          nextIdx >= 0
                            ? slides[nextIdx]?.fill.media?.mediaId
                            : undefined
                        setLive({
                          kind: slide.kind,
                          sourceItemId,
                          slideIndex: idx,
                          fill: slide.fill,
                          fontSizeOverrideByTemplate: templateMins,
                          transitionKind: playback?.transitionKind,
                          transitionDurationMs: playback?.transitionDurationMs,
                          nextMediaId,
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
  pausedAffordance,
}: {
  slide: Slide
  template: Template | undefined
  active: boolean
  fontSizeOverride: number | undefined
  onFitComputed: (slot: SlotName, fontSize: number) => void
  onClick: () => void
  // Set only for presentation tiles while loop auto-advance is on.
  // The overlay is hover-revealed and toggles the parent's auto-pause
  // state on click. We use a nested span+role="button" instead of a
  // real <button> to avoid invalid nested-button HTML — the outer
  // tile is already a <button>.
  pausedAffordance?: { paused: boolean; onToggle: () => void }
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
      {pausedAffordance && (
        // Small corner chip — hover-revealed when running, persistent
        // when paused (so the operator can see the current state at a
        // glance). Lives in the top-left so it doesn't fight the
        // bottom-aligned caption bar or the trash icon convention.
        // Clicks here stop propagation; clicks anywhere ELSE on the
        // tile fall through to the underlying button's "go live"
        // onClick — which is the bug we just fixed (the previous
        // full-tile overlay was swallowing every click).
        <span
          role="button"
          tabIndex={0}
          aria-label={pausedAffordance.paused ? "Resume auto-advance" : "Pause auto-advance"}
          onClick={(e) => {
            e.stopPropagation()
            pausedAffordance.onToggle()
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              e.stopPropagation()
              pausedAffordance.onToggle()
            }
          }}
          className={cn(
            "absolute left-1.5 top-1.5 grid size-6 cursor-pointer place-items-center rounded bg-background/70 text-foreground backdrop-blur transition-opacity",
            pausedAffordance.paused
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
          )}
        >
          {pausedAffordance.paused ? (
            <PlayIcon className="size-3.5" />
          ) : (
            <PauseIcon className="size-3.5" />
          )}
        </span>
      )}
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
    return <VideoThumb src={`/media-asset/${mediaId}`} />
  }
  return (
    <div className="grid h-full w-full place-items-center bg-muted/30 text-muted-foreground/40">
      <PlayIcon className="size-5 opacity-60" />
    </div>
  )
}

// VideoThumb seeks the element to ~0.5s once metadata loads so the
// tile shows a frame mid-action instead of the usually-black first
// frame. preload="auto" tells the browser to fetch enough bytes to
// satisfy the seek; once cached, clicking the tile to go live is
// instant because the same /media-asset URL is already warm in this
// webview's HTTP cache.
function VideoThumb({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  return (
    <video
      ref={ref}
      src={src}
      className="absolute inset-0 h-full w-full object-cover"
      preload="auto"
      muted
      playsInline
      onLoadedMetadata={(e) => {
        const el = e.currentTarget
        const t = Math.min(0.5, Math.max(0, (el.duration || 0) - 0.1))
        if (Number.isFinite(t) && t > 0) el.currentTime = t
      }}
    />
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
            preload="auto"
            playsInline
            className="h-full w-full"
            onClick={(e) => e.stopPropagation()}
            onLoadedMetadata={(e) => {
              const el = e.currentTarget
              // Seek to ~0.5s so the preview surface shows a real
              // frame instead of opening on the first (often-black)
              // frame. Operator can still scrub freely.
              const t = Math.min(0.5, Math.max(0, (el.duration || 0) - 0.1))
              if (Number.isFinite(t) && t > 0) el.currentTime = t
            }}
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
