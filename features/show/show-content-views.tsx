import { useEffect, useRef, type KeyboardEvent } from "react"
import { motion } from "motion/react"
import type { Slide } from "@/features/live/slides"
import { songSectionType } from "@/features/songs/section-types"
import type { SlotValue } from "@/features/templates/types"
import { useBibleTranslations } from "@/hooks/use-bible-translations"
import { cn } from "@/lib/utils"

// One distinct color per translation slot (primary / secondary /
// tertiary), shown only when more than one translation is configured.
// App theme tokens only: chart-3 (amber/gold) leads, then chart-5 and
// chart-4. Skips chart-1 (blue, hard to read) and chart-2 (the live
// green). Tweak here to recolor.
const TRANSLATION_COLORS = ["text-chart-3", "text-chart-5", "text-chart-4"] as const

// Show-pane content views for song and bible items. These replace the
// old template-thumbnail tiles: previewing a single display's template
// binding was misleading once multiple displays carry different
// bindings (the "technical default" problem). Instead we render the
// actual content — readable, the same way the library tabs show it —
// and let each audience window render its own bound template. Clicking
// a section/verse pushes it live (no separate Send affordance); the
// live unit highlights.
//
// The uniform-fit measurement that audience outputs rely on is NOT done
// here — the show pane's off-screen measurement layer still renders the
// bound templates invisibly and feeds fontSizeOverrideByTemplate.

type ViewProps = {
  slides: Slide[]
  // True when the slide at idx is the current live slide for this source.
  isLiveAt: (idx: number) => boolean
  // Push the slide at idx live (or clear, if it is already live).
  onSelect: (idx: number) => void
}

// SlotValue is string | RichText (span list). Bible/song fills are
// plain strings today, but coerce defensively so a rich fill still
// renders as text in the operator preview.
function slotText(v: SlotValue | undefined): string {
  if (!v) return ""
  if (typeof v === "string") return v
  return v.map((s) => s.text).join("")
}

// Song — one tile per broadcast section (chunk), colored by section
// type, same look as the Songs library tab. The label ("Verse 1",
// "Chorus 1", …) is the per-type numbering already baked into the
// slide caption by useSongSlides.
export function SongShowView({ slides, isLiveAt, onSelect }: ViewProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <motion.div
        className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))]"
        variants={gridVariants}
        initial="hidden"
        animate="visible"
      >
        {slides.map((slide, idx) => {
          const t = songSectionType(slide.sectionType)
          // caption is `${title} · ${label}` — the label is the part
          // after the separator. Fall back to the type label.
          const label = slide.caption.split(" · ")[1] ?? t.label
          const live = isLiveAt(idx)
          const lines = slide.body.split("\n")
          return (
            <motion.div
              key={idx}
              variants={tileVariants}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(idx)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onSelect(idx)
                }
              }}
              className={cn(
                "group relative flex cursor-pointer flex-col border-b border-l-2 border-r border-b-border/40 border-r-border/40 outline-none transition-colors",
                t.border,
                live ? "bg-chart-2/5" : "hover:bg-muted/40"
              )}
            >
              <div className="pl-2.5 pr-1.5 py-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  {label}
                </span>
              </div>
              <div className="flex-1 px-3 pb-2">
                {lines.map((line, i) => (
                  <div
                    key={i}
                    className="text-xs leading-relaxed text-foreground/90"
                  >
                    {line || " "}
                  </div>
                ))}
              </div>
            </motion.div>
          )
        })}
      </motion.div>
    </div>
  )
}

// Bible — one row per verse, dense list like the Bible library tab's
// verse pane. Secondary/tertiary translations stack under the primary
// line (dimmed) only when the operator has them enabled. Live verse
// gets the chart-2 left rail, matching the app's accent philosophy.
type BibleViewProps = ViewProps & {
  // Verse immediately after the selected range, shown dimmed as a
  // read-ahead ("next-verse preview" setting). null when the setting
  // is off or the range already ends the chapter.
  peek?: Slide | null
  // Click handler for the peek row — grows the passage to include that
  // verse and goes live, in the same single click as any other verse.
  onPeekSelect?: () => void
  // Verse just before the range, shown dimmed ABOVE the list once the
  // operator has armed the up-preview. null when not armed / setting off
  // / at the chapter start.
  peekBack?: Slide | null
  onPeekBackSelect?: () => void
}

export function BibleShowView({
  slides,
  isLiveAt,
  onSelect,
  peek,
  onPeekSelect,
  peekBack,
  onPeekBackSelect,
}: BibleViewProps) {
  // Translation codes (e.g. "KJV", "NIV") double as the per-row labels.
  // Labels + colors only kick in when more than one translation is
  // configured — a single translation stays clean foreground text.
  const { state: tr } = useBibleTranslations()
  const codes = [tr.primary, tr.secondary, tr.tertiary]
  const multi = !!tr.secondary || !!tr.tertiary

  // Keep the live verse — and the next-verse preview just below it — in
  // view as the operator advances. Scroll up when the live row (plus a
  // margin for the upcoming verse) would fall past the bottom; scroll
  // down if it's above the top. Only nudges when needed, so it never
  // fights manual scrolling. rAF defers a frame so a just-grown row is
  // laid out before we measure.
  const scrollRef = useRef<HTMLDivElement>(null)
  const liveIdx = slides.findIndex((_, i) => isLiveAt(i))
  useEffect(() => {
    if (liveIdx < 0) return
    const c = scrollRef.current
    if (!c) return
    const id = requestAnimationFrame(() => {
      const el = c.querySelector<HTMLElement>(`[data-verse-idx="${liveIdx}"]`)
      if (!el) return
      const cRect = c.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      const margin = 96 // room to keep the upcoming verse visible below
      if (elRect.bottom + margin > cRect.bottom) {
        c.scrollBy({ top: elRect.bottom + margin - cRect.bottom, behavior: "smooth" })
      } else if (elRect.top < cRect.top + 8) {
        c.scrollBy({ top: elRect.top - cRect.top - 8, behavior: "smooth" })
      }
    })
    return () => cancelAnimationFrame(id)
  }, [liveIdx, slides.length])

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-0.5 py-2">
      <motion.div variants={gridVariants} initial="hidden" animate="visible">
        {peekBack && (
          <BibleVerseRow
            key="peekBack"
            slide={peekBack}
            codes={codes}
            multi={multi}
            live={false}
            peek
            onSelect={onPeekBackSelect}
          />
        )}
        {slides.map((slide, idx) => (
          <BibleVerseRow
            key={idx}
            index={idx}
            slide={slide}
            codes={codes}
            multi={multi}
            live={isLiveAt(idx)}
            onSelect={() => onSelect(idx)}
          />
        ))}
        {peek && (
          <BibleVerseRow
            key="peek"
            slide={peek}
            codes={codes}
            multi={multi}
            live={false}
            peek
            onSelect={onPeekSelect}
          />
        )}
      </motion.div>
    </div>
  )
}

function BibleVerseRow({
  index,
  slide,
  codes,
  multi,
  live,
  peek,
  onSelect,
}: {
  // Index within the verse list — the auto-scroll targets the live row
  // by this. Omitted for the peek row (not a scroll target).
  index?: number
  slide: Slide
  codes: (string | null)[]
  multi: boolean
  live: boolean
  // Dimmed read-ahead row. Clickable like any verse — clicking grows
  // the passage to it and goes live.
  peek?: boolean
  onSelect?: () => void
}) {
  // caption is `${book} ${chapter}:${verse}` — the verse number is the
  // part after the last colon.
  const num = slide.caption.split(":").pop() ?? ""
  const texts = [
    slide.body,
    slotText(slide.fill.secondary),
    slotText(slide.fill.tertiary),
  ]
  const interactive = !!onSelect
  return (
    <motion.div
      variants={rowVariants}
      data-verse-idx={index}
      {...(interactive
        ? {
            role: "button",
            tabIndex: 0,
            onClick: onSelect,
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onSelect?.()
              }
            },
          }
        : {})}
      className={cn(
        "block w-full border-l-2 px-3 py-1.5 text-left outline-none transition-colors",
        peek
          ? "border-l-transparent"
          : live
            ? "border-l-chart-2 bg-chart-2/5"
            : "border-l-transparent",
        interactive && "cursor-pointer hover:bg-muted/40"
      )}
    >
      {/* Dim lives on this inner wrapper, NOT the motion row: Framer sets
          the row's inline opacity to 1 via its variant, which would
          override a Tailwind opacity class. The peek (next-verse preview)
          reads clearly dimmer and brightens on hover so it's obviously
          clickable. */}
      <div
        className={cn(
          "flex gap-2.5",
          peek &&
            "opacity-60 transition-opacity duration-200 hover:opacity-100"
        )}
      >
        <span className="min-w-[16px] shrink-0 pt-0.5 text-right text-[10px] tabular-nums text-muted-foreground/60">
          {num}
        </span>
        <div className="flex flex-1 flex-col gap-1.5">
          {texts.map((t, i) =>
            t ? (
              <div key={i} className="flex flex-col gap-0.5">
                {multi && codes[i] && (
                  <span
                    className={cn(
                      "text-[9px] font-bold uppercase tracking-[0.14em]",
                      TRANSLATION_COLORS[i]
                    )}
                  >
                    {codes[i]}
                  </span>
                )}
                <span
                  className={cn(
                    "text-[13px] leading-relaxed",
                    // The live verse reads in full foreground (cleaner,
                    // emphasised); other rows keep color on the bright
                    // label with neutral, dimmed text when multi-translation.
                    live
                      ? "text-foreground"
                      : multi
                        ? "text-muted-foreground"
                        : "text-foreground/90"
                  )}
                >
                  {t}
                </span>
              </div>
            ) : null
          )}
        </div>
      </div>
    </motion.div>
  )
}

const gridVariants = {
  visible: { transition: { staggerChildren: 0.025, delayChildren: 0.04 } },
  hidden: {},
}

const tileVariants = {
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 500, damping: 30 },
  },
  hidden: { opacity: 0, y: -6 },
}

const rowVariants = {
  // Gentle fade-in — no vertical movement. A slide here read as busy
  // (and risked clipping the top row); a calm fade on the app's standard
  // easing feels better and stays consistent without being snappy.
  visible: {
    opacity: 1,
    transition: { duration: 0.22, ease: [0.32, 0.72, 0, 1] as const },
  },
  hidden: { opacity: 0 },
}
