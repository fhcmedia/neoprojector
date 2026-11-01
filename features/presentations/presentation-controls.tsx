import { useMemo, useState } from "react"
import {
  EyeIcon,
  EyeOffIcon,
  FilePlus2Icon,
  Loader2Icon,
  RepeatIcon,
  TimerIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/button"
import { Input } from "@/components/input"
import { InlineConfirm } from "@/components/inline-confirm"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/popover"
import { cn } from "@/lib/utils"
import type { PresentationPlayback, Slide } from "@/features/live/slides"
import {
  useDeleteSlide,
  useSlideOptions,
  useUpdatePlayback,
} from "@/features/presentations/api"

// Presentation editing controls for the Show pane: a toolbar (auto-
// advance, default slide time, add slides, include/exclude whole decks)
// and a strip under each slide (include, its own time, delete).

const PRESETS_S = [3, 5, 8, 10, 15, 30, 60]

export function formatSeconds(ms: number): string {
  const s = ms / 1000
  if (s >= 60 && s % 60 === 0) return `${s / 60}m`
  return Number.isInteger(s) ? `${s}s` : `${s.toFixed(1)}s`
}

// SecondsEditor: presets plus a free number field (seconds).
function SecondsEditor({
  valueMs,
  onChange,
  allowDefault,
}: {
  valueMs: number
  onChange: (ms: number) => void
  allowDefault?: { label: string }
}) {
  const [draft, setDraft] = useState(valueMs > 0 ? String(valueMs / 1000) : "")
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n > 0) onChange(Math.round(n * 1000))
  }
  return (
    <div className="flex w-56 flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS_S.map((s) => (
          <Button
            key={s}
            size="xs"
            variant={valueMs === s * 1000 ? "default" : "outline"}
            onClick={() => {
              setDraft(String(s))
              onChange(s * 1000)
            }}
          >
            {formatSeconds(s * 1000)}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0.25}
          step={0.5}
          value={draft}
          placeholder="seconds"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
          }}
          onBlur={commit}
          className="h-7 text-xs"
          aria-label="Seconds"
        />
        <span className="text-xs text-muted-foreground">sec</span>
      </div>
      {allowDefault && (
        <Button
          size="xs"
          variant={valueMs === 0 ? "default" : "ghost"}
          onClick={() => {
            setDraft("")
            onChange(0)
          }}
        >
          {allowDefault.label}
        </Button>
      )}
    </div>
  )
}

export function PresentationToolbar({
  presentationId,
  playback,
  slides,
  importing,
  onAddFiles,
}: {
  presentationId: number
  playback: PresentationPlayback | null
  slides: Slide[]
  importing: string | null
  onAddFiles: () => void
}) {
  const updatePlayback = useUpdatePlayback(presentationId)
  const { setSourceEnabled, setAllEnabled } = useSlideOptions(presentationId)
  const interval = playback?.intervalMs ?? 5000
  const loop = playback?.loop ?? false
  const save = (patch: Partial<{ loop: boolean; interval_ms: number }>) =>
    updatePlayback.mutate({
      loop,
      interval_ms: interval,
      transition_kind: playback?.transitionKind ?? "fade",
      transition_duration_ms: playback?.transitionDurationMs ?? 500,
      ...patch,
    })

  // Imported decks (slides sharing a source), for group include/exclude.
  const decks = useMemo(() => {
    const m = new Map<string, { total: number; included: number }>()
    for (const s of slides) {
      if (!s.source) continue
      const d = m.get(s.source) ?? { total: 0, included: 0 }
      d.total++
      if (!s.excluded) d.included++
      m.set(s.source, d)
    }
    return [...m.entries()]
  }, [slides])
  const included = slides.filter((s) => !s.excluded).length

  return (
    <div className="flex flex-col border-b border-border/40">
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
        <Button
          size="xs"
          variant={loop ? "default" : "outline"}
          onClick={() => save({ loop: !loop })}
          aria-label={loop ? "Auto-advance on — click to turn off" : "Auto-advance off — click to turn on"}
        >
          <RepeatIcon className="size-3.5" />
          {loop ? "Auto-advance on" : "Auto-advance off"}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button size="xs" variant="outline" aria-label="Default time per slide">
              <TimerIcon className="size-3.5" />
              Every {formatSeconds(interval)}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3">
            <div className="mb-2 text-xs font-medium">Default time per slide</div>
            <SecondsEditor valueMs={interval} onChange={(ms) => save({ interval_ms: ms })} />
          </PopoverContent>
        </Popover>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {included}/{slides.length} included
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {slides.length > 0 && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => setAllEnabled.mutate(included < slides.length)}
            >
              {included < slides.length ? "Include all" : "Exclude all"}
            </Button>
          )}
          <Button size="xs" variant="outline" onClick={onAddFiles} disabled={!!importing}>
            {importing ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <FilePlus2Icon className="size-3.5" />
            )}
            {importing ?? "Add slides"}
          </Button>
        </div>
      </div>
      {decks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5">
          {decks.map(([source, d]) => {
            const on = d.included > 0
            return (
              <Button
                key={source}
                size="xs"
                variant={on ? "outline" : "ghost"}
                className={cn(!on && "text-muted-foreground line-through")}
                onClick={() => setSourceEnabled.mutate({ source, enabled: !on })}
                title={on ? "Exclude this whole deck" : "Include this whole deck"}
              >
                {on ? <EyeIcon className="size-3" /> : <EyeOffIcon className="size-3" />}
                <span className="max-w-48 truncate">{source}</span>
                <span className="text-muted-foreground">
                  {d.included}/{d.total}
                </span>
              </Button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// SlideControls: the strip under one presentation slide.
export function SlideControls({
  slide,
  presentationId,
  intervalMs,
}: {
  slide: Slide
  presentationId: number
  intervalMs: number
}) {
  const { setEnabled, setDuration } = useSlideOptions(presentationId)
  const del = useDeleteSlide(presentationId)
  const [confirm, setConfirm] = useState(false)
  const id = slide.presentationSlideId
  if (id === undefined) return null
  if (confirm) {
    return (
      <InlineConfirm
        message="Remove this slide?"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          del.mutate(id)
        }}
        className="rounded-b border-b-0 px-1.5 py-1"
      />
    )
  }
  const own = slide.durationMs ?? 0
  return (
    <div className="flex items-center gap-1 px-0.5 pt-1">
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setEnabled.mutate({ slideId: id, enabled: !!slide.excluded })}
        aria-label={slide.excluded ? "Include this slide" : "Exclude this slide"}
        title={slide.excluded ? "Skipped — click to include" : "Included — click to skip"}
        className={cn(slide.excluded && "text-muted-foreground")}
      >
        {slide.excluded ? <EyeOffIcon className="size-3" /> : <EyeIcon className="size-3" />}
        {slide.excluded ? "Skipped" : "Included"}
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="xs"
            variant="ghost"
            aria-label="Time on screen"
            className={cn(own === 0 && "text-muted-foreground")}
          >
            <TimerIcon className="size-3" />
            {own > 0 ? formatSeconds(own) : `${formatSeconds(intervalMs)} (default)`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <div className="mb-2 text-xs font-medium">Time on screen (auto-advance)</div>
          <SecondsEditor
            valueMs={own}
            onChange={(ms) => setDuration.mutate({ slideId: id, durationMs: ms })}
            allowDefault={{ label: `Use default (${formatSeconds(intervalMs)})` }}
          />
        </PopoverContent>
      </Popover>
      <Button
        size="icon-xs"
        variant="ghost"
        className="ml-auto text-muted-foreground hover:text-destructive"
        aria-label="Remove slide"
        onClick={() => setConfirm(true)}
      >
        <Trash2Icon className="size-3" />
      </Button>
    </div>
  )
}
