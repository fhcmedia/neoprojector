import { useEffect, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type {
  ListServiceItemsWithContentRow,
  Template,
} from "@/bindings/neoprojector/database"
import {
  useAdHocBibleSlides,
  useItemSlides,
  type Slide,
} from "@/features/live/slides"
import { useLive } from "@/features/live/live-context"
import { useShowTemplate } from "@/features/show/use-show-template"
import { ScaledTemplate } from "@/features/templates/renderer"
import { songSectionType } from "@/features/songs/section-types"
import { cn } from "@/lib/utils"

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
  }, [qc, activeItemId, adHocBibleRef])

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

  // sourceItemId is the live-state correlator: schedule items use
  // their row id; ad-hoc bible uses null. Keeping these distinct
  // means click-to-toggle works correctly in either mode.
  const sourceItemId: number | null = item ? item.id : null

  const { setLive, isLive, registerNavigators } = useLive()

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
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adHocKey, adHocSlides.isLoading])

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
      })
    }
    registerNavigators({
      next: () => {
        const cur = liveIndex()
        if (cur < 0) {
          if (slides.length > 0) setIndex(0)
          return
        }
        if (cur + 1 < slides.length) setIndex(cur + 1)
      },
      prev: () => {
        const cur = liveIndex()
        if (cur > 0) setIndex(cur - 1)
      },
    })
  }, [slides, sourceItemId, isLive, setLive, registerNavigators])

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
        {!item && !adHocBibleRef ? (
          <Empty>{emptyPrompt}</Empty>
        ) : isLoading ? (
          <Empty muted>Loading…</Empty>
        ) : slides.length === 0 ? (
          <Empty>This item has no content yet</Empty>
        ) : item && item.kind === "media" ? (
          <div className="relative flex-1 bg-muted/30">
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-[10px] text-muted-foreground/40">
              {slides[0].body}
            </div>
          </div>
        ) : (
          <div className="grid flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2 overflow-y-auto p-2">
            {slides.map((slide, idx) => {
              const active = isLive(slide.kind, sourceItemId, idx)
              return (
                <SlideTile
                  key={idx}
                  slide={slide}
                  template={templateForSlide(slide)}
                  active={active}
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
                    })
                  }}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function SlideTile({
  slide,
  template,
  active,
  onClick,
}: {
  slide: Slide
  template: Template | undefined
  active: boolean
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
      className="group relative block aspect-video w-full overflow-hidden bg-muted/30 transition-colors"
    >
      {template ? (
        <ScaledTemplate
          template={template}
          fill={slide.fill}
          measure={false}
          className="absolute inset-0 h-full w-full"
        />
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
          "pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1 text-[10px] transition-opacity duration-150",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <span
          className={cn(
            "truncate uppercase tracking-wider",
            active ? "text-emerald-500" : "text-foreground/80"
          )}
        >
          {slide.caption}
        </span>
        {active && (
          <span className="shrink-0 uppercase tracking-wider text-emerald-500">
            Live
          </span>
        )}
      </div>
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
