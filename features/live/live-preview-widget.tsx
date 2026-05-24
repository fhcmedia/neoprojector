import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClockIcon,
  FileTextIcon,
  ImageIcon,
  LayersIcon,
  LockIcon,
  PauseIcon,
  PlayIcon,
  PowerIcon,
  RadioIcon,
  UnlockIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "lucide-react"
import { useLive, type ActiveOverlay } from "@/features/live/live-context"
import { useLiveOutput } from "@/features/displays/api"
import { widgetDef } from "@/features/overlays/widgets"
import {
  parseConfig,
  parseLayouts,
  parseRules,
  resolveLayout,
  type WidgetKind,
} from "@/features/overlays/types"
import { motionProps, type AnimKind } from "@/features/animations/variants"
import { cn } from "@/lib/utils"

// LivePreviewWidget: persistent corner card showing what's currently
// on the live output. Auto-shows when something is live; auto-hides
// when cleared. Operator can collapse it to a pill when it's in the
// way; the pill still reflects live/off-air state at a glance.
//
// Mounted once in the app shell so it follows the operator across
// every route (presentation editor, schedule editor, library).
export function LivePreviewWidget() {
  const { live, activeOverlays, clearLive, toggleOverlay } = useLive()
  const { data: outputLive = false } = useLiveOutput()
  const [collapsed, setCollapsed] = useState(false)
  const [tick, setTick] = useState(0)
  const [locked, setLocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    try {
      return window.localStorage.getItem(LOCK_KEY) === "1"
    } catch {
      return false
    }
  })
  // Watch storage so the ControlBar's lock toggle updates this header
  // copy too. localStorage events only fire across tabs; for in-tab
  // sync we use a custom event on the same window.
  useEffect(() => {
    const handler = () => {
      try {
        setLocked(window.localStorage.getItem(LOCK_KEY) === "1")
      } catch { /* noop */ }
    }
    window.addEventListener("np:live-lock-changed", handler)
    return () => window.removeEventListener("np:live-lock-changed", handler)
  }, [])

  // Conflict detection: when a slide is live AND one or more active
  // overlays opt into cover_slide, the audience sees only the overlay —
  // the slide is invisible. Surface this with a banner + one-tap
  // "Take overlays off" action so the operator can recover without
  // hunting through the schedule.
  const coveringOverlays = useMemo(() => {
    if (!live) return []
    return activeOverlays.filter((a) => {
      const def = widgetDef(a.overlayKind as WidgetKind)
      return parseRules(a.rulesJSON, def.defaultRules).cover_slide === true
    })
  }, [live, activeOverlays])
  const hasConflict = coveringOverlays.length > 0

  // Periodically force a re-render so a "live but no displays open"
  // state can still drive the pulsing indicator without us caring
  // about the underlying live payload identity.
  useEffect(() => {
    if (!live && activeOverlays.length === 0) return
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [live, activeOverlays.length])

  const hasContent = !!live || activeOverlays.length > 0
  const onAir = hasContent && outputLive

  return (
    <AnimatePresence>
      {hasContent && (
        <motion.div
          key="live-preview-widget"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 360, damping: 32 }}
          className={cn(
            "fixed bottom-4 right-4 z-50 select-none overflow-hidden rounded-xl border shadow-2xl backdrop-blur-md",
            "bg-background/85 ring-1 ring-black/40",
            hasConflict
              ? "border-amber-500/70"
              : onAir
                ? "border-red-500/60"
                : "border-border/60"
          )}
          style={{
            width: collapsed ? "auto" : 280,
          }}
          data-tick={tick}
        >
          {/* Header bar — always visible, collapse + close controls */}
          <div className="flex items-center gap-1.5 border-b border-border/40 bg-background/60 px-2.5 py-1.5">
            <span
              className={cn(
                "grid size-4 place-items-center rounded-full transition-colors",
                onAir ? "text-red-400" : "text-muted-foreground/60"
              )}
            >
              <RadioIcon className={cn("size-3", onAir && "animate-pulse")} />
            </span>
            <span
              className={cn(
                "text-[10px] font-semibold uppercase tracking-wider",
                onAir ? "text-red-400" : "text-muted-foreground/80"
              )}
            >
              {onAir ? "On air" : "Staged"}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setCollapsed((v) => !v)}
                aria-label={collapsed ? "Expand preview" : "Collapse preview"}
                className="grid size-5 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground"
              >
                {collapsed ? (
                  <ChevronUpIcon className="size-3" />
                ) : (
                  <ChevronDownIcon className="size-3" />
                )}
              </button>
              {locked && (
                <span
                  title="Output locked — clears disabled"
                  className="grid size-5 place-items-center rounded text-amber-300"
                >
                  <LockIcon className="size-3" />
                </span>
              )}
              <button
                type="button"
                onClick={() => !locked && clearLive()}
                disabled={locked}
                aria-label="Take off live"
                title={locked ? "Output locked" : "Take off live"}
                className={cn(
                  "grid size-5 place-items-center rounded transition-colors",
                  locked
                    ? "cursor-not-allowed text-muted-foreground/30"
                    : "text-muted-foreground/70 hover:bg-destructive/20 hover:text-destructive"
                )}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          </div>

          {/* Conflict banner — always shown when an overlay is hiding
              the live slide, including when the widget is collapsed.
              Operator should never miss this. */}
          <AnimatePresence initial={false}>
            {hasConflict && (
              <motion.div
                key="conflict-banner"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden border-b border-amber-500/40 bg-amber-500/10"
              >
                <div className="flex items-start gap-2 px-2.5 py-1.5">
                  <AlertTriangleIcon className="mt-0.5 size-3 shrink-0 text-amber-400" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[10px] leading-snug text-amber-200/90">
                      {coveringOverlays.length === 1 ? (
                        <>
                          <span className="font-semibold">
                            {coveringOverlays[0].name || coveringOverlays[0].overlayKind}
                          </span>{" "}
                          is hiding the live slide.
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">{coveringOverlays.length} overlays</span>{" "}
                          are hiding the live slide.
                        </>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        for (const o of coveringOverlays) {
                          toggleOverlay({
                            scheduleItemId: o.scheduleItemId,
                            overlayKind: o.overlayKind,
                            name: o.name,
                            configJSON: o.configJSON,
                            layoutsJSON: o.layoutsJSON,
                            rulesJSON: o.rulesJSON,
                          })
                        }
                      }}
                      className="self-start rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200 transition-colors hover:bg-amber-500/30 hover:text-amber-100"
                    >
                      Take {coveringOverlays.length === 1 ? "overlay" : "overlays"} off
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Body — preview area, hidden when collapsed */}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                key="body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden"
              >
                <LiveBody />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function LiveBody() {
  const { live, activeOverlays } = useLive()
  if (!live && activeOverlays.length === 0) return null
  const caption = live
    ? typeof live.fill.caption === "string"
      ? live.fill.caption
      : Array.isArray(live.fill.caption)
        ? live.fill.caption.map((s) => s.text).join("")
        : ""
    : ""

  // Match audience output: any active overlay whose rules opt into
  // cover_slide suppresses the underlying slide entirely.
  const overlaysCoverSlide = activeOverlays.some((a) => {
    const def = widgetDef(a.overlayKind as WidgetKind)
    return parseRules(a.rulesJSON, def.defaultRules).cover_slide === true
  })

  const media = !overlaysCoverSlide ? live?.fill.media : undefined
  const primary = live
    ? typeof live.fill.primary === "string"
      ? live.fill.primary
      : Array.isArray(live.fill.primary)
        ? live.fill.primary.map((s) => s.text).join("")
        : ""
    : ""

  return (
    <div className="flex flex-col gap-1.5 p-2">
      <motion.div
        key={`${live?.kind ?? "overlays-only"}-${live?.sourceItemId ?? 0}-${live?.slideIndex ?? 0}`}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="relative aspect-video w-full overflow-hidden rounded-md bg-black ring-1 ring-border/40"
      >
        {media ? (
          <MediaTile mediaId={media.mediaId} muted={media.muted ?? true} />
        ) : live && !overlaysCoverSlide ? (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-black to-zinc-900 p-2 text-center">
            <span className="line-clamp-4 text-[10px] leading-snug text-white/90">
              {primary || "—"}
            </span>
          </div>
        ) : (
          // Overlay-cover or overlay-only state — canvas stays black so
          // the overlay sits on top of the same audience background it
          // would have on the real output.
          <div className="absolute inset-0 bg-black" />
        )}
        {/* Overlays layered on top of the base slide — mirrors what the
            audience output does. Layouts are scaled by percentage, so
            the same x/y/w/h math works at any preview size. */}
        <OverlayLayer overlays={activeOverlays} />
      </motion.div>
      {caption && (
        <span className="truncate text-[10px] text-muted-foreground/80">
          {caption}
        </span>
      )}
    </div>
  )
}

// Time-based widget kinds — the timer-quick-clear button kills only
// these, leaving non-temporal overlays (preacher name card, QR code,
// arbitrary message) on screen.
const TIMER_KINDS = new Set<string>(["countdown", "sermon_timer", "clock"])

const LOCK_KEY = "np.live.outputLocked"

// ControlBar mirrors FreeShow's clear/nav strip below the preview tile.
// Three rows:
//   1. nav   — prev | next | play/pause | lock | clear-live
//   2. clear — full-width "Clear all" (live + every overlay)
//   3. cats  — background | slide | overlays | audio | timer
// Each control disables itself when its target scope is empty so the
// operator can't fire a no-op. Lock is operator-side only (the audience
// output isn't aware of it) — its purpose is to stop a stray click
// from blanking the screen mid-service.
export function ControlBar() {
  const {
    live,
    activeOverlays,
    clearLive,
    clearOverlays,
    setMediaPlayback,
    setLive,
    toggleOverlay,
    navigateNext,
    navigatePrev,
  } = useLive()

  const [locked, setLocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    try {
      return window.localStorage.getItem(LOCK_KEY) === "1"
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem(LOCK_KEY, locked ? "1" : "0")
      window.dispatchEvent(new Event("np:live-lock-changed"))
    } catch { /* quota / private-mode — non-fatal */ }
  }, [locked])

  const hasLive = !!live
  const hasMedia = !!live?.fill.media
  const isPlaying = live?.fill.media?.playing ?? false
  const isMuted = live?.fill.media?.muted ?? false
  const hasOverlays = activeOverlays.length > 0
  const hasTimers = activeOverlays.some((o) => TIMER_KINDS.has(o.overlayKind))

  // Auto-advance: cycles through slides at a fixed cadence using the
  // navigator the show pane registered. The slide list itself is opaque
  // to us — we just kick navigateNext on the interval — so this works
  // for any source that has multiple slides (presentations, bible
  // ranges, songs).
  const [advancing, setAdvancing] = useState(false)
  const [advanceMs, setAdvanceMs] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem("np.live.advanceMs")
      const n = raw ? Number(raw) : NaN
      return Number.isFinite(n) && n >= 500 ? n : 4000
    } catch {
      return 4000
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem("np.live.advanceMs", String(advanceMs))
    } catch { /* noop */ }
  }, [advanceMs])
  useEffect(() => {
    if (!advancing || locked) return
    if (!hasLive) {
      setAdvancing(false)
      return
    }
    const id = window.setInterval(() => navigateNext(), Math.max(500, advanceMs))
    return () => window.clearInterval(id)
  }, [advancing, advanceMs, locked, hasLive, navigateNext])
  // Stop auto-advance when live clears externally (e.g. operator pulls
  // the plug from elsewhere).
  useEffect(() => {
    if (!hasLive && advancing) setAdvancing(false)
  }, [hasLive, advancing])
  const anything = hasLive || hasOverlays

  function guard<T extends (...args: never[]) => void>(fn: T): T {
    return ((...args: Parameters<T>) => {
      if (locked) return
      fn(...args)
    }) as T
  }

  function clearAllNow() {
    if (locked) return
    clearLive()
    clearOverlays()
  }

  function killTimers() {
    if (locked) return
    for (const o of activeOverlays) {
      if (TIMER_KINDS.has(o.overlayKind)) {
        toggleOverlay({
          scheduleItemId: o.scheduleItemId,
          overlayKind: o.overlayKind,
          name: o.name,
          configJSON: o.configJSON,
          layoutsJSON: o.layoutsJSON,
          rulesJSON: o.rulesJSON,
        })
      }
    }
  }

  function clearBackgroundOnly() {
    if (locked || !live?.fill.media) return
    // Drop the media fill but keep the rest of the slide visible — so
    // a song that had a video bg falls back to template default bg.
    setLive({
      ...live,
      fill: { ...live.fill, media: undefined },
    })
  }

  return (
    <div className="mt-1 flex flex-col gap-1 rounded-md bg-background/40 p-1 ring-1 ring-border/30">
      {/* Row 1 — nav strip */}
      <div className="flex items-stretch gap-1">
        <ControlButton
          label="Previous slide"
          onClick={guard(navigatePrev)}
          disabled={!hasLive}
        >
          <ChevronLeftIcon className="size-3" />
        </ControlButton>
        <ControlButton
          label="Next slide"
          onClick={guard(navigateNext)}
          disabled={!hasLive}
        >
          <ChevronRightIcon className="size-3" />
        </ControlButton>
        <ControlButton
          label={isPlaying ? "Pause media" : "Play media"}
          onClick={guard(() => setMediaPlayback({ playing: !isPlaying }))}
          disabled={!hasMedia}
        >
          {isPlaying ? (
            <PauseIcon className="size-3" />
          ) : (
            <PlayIcon className="size-3" />
          )}
        </ControlButton>
        <ControlButton
          label={locked ? "Unlock output" : "Lock output"}
          onClick={() => setLocked((v) => !v)}
          tone={locked ? "warning" : "neutral"}
        >
          {locked ? (
            <LockIcon className="size-3" />
          ) : (
            <UnlockIcon className="size-3" />
          )}
        </ControlButton>
        <ControlButton
          label="Take slide off live"
          onClick={guard(() => clearLive())}
          disabled={!hasLive}
          tone="danger"
        >
          <PowerIcon className="size-3" />
        </ControlButton>
      </div>

      {/* Row 2 — clear-all full-width button */}
      <button
        type="button"
        onClick={clearAllNow}
        disabled={locked || !anything}
        className={cn(
          "flex w-full items-center justify-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
          locked || !anything
            ? "cursor-not-allowed bg-background/30 text-muted-foreground/40"
            : "bg-destructive/15 text-destructive hover:bg-destructive/25"
        )}
        title={locked ? "Output locked" : "Clear everything from live"}
      >
        <XIcon className="size-3" />
        Clear all
      </button>

      {/* Row 3 — category strip */}
      <div className="flex items-stretch gap-1">
        <ControlButton
          label="Clear background"
          onClick={clearBackgroundOnly}
          disabled={!hasMedia}
        >
          <ImageIcon className="size-3" />
        </ControlButton>
        <ControlButton
          label="Clear slide"
          onClick={guard(() => clearLive())}
          disabled={!hasLive}
        >
          <FileTextIcon className="size-3" />
        </ControlButton>
        <ControlButton
          label="Clear overlays"
          onClick={guard(() => clearOverlays())}
          disabled={!hasOverlays}
        >
          <LayersIcon className="size-3" />
        </ControlButton>
        <ControlButton
          label={isMuted ? "Unmute audio" : "Mute audio"}
          onClick={guard(() => setMediaPlayback({ muted: !isMuted }))}
          disabled={!hasMedia}
        >
          {isMuted ? (
            <VolumeXIcon className="size-3" />
          ) : (
            <Volume2Icon className="size-3" />
          )}
        </ControlButton>
        <ControlButton
          label={
            advancing
              ? `Stop auto-advance (${(advanceMs / 1000).toFixed(1)}s)`
              : hasTimers
                ? "Clear timer overlays · Shift-click to auto-advance"
                : `Auto-advance every ${(advanceMs / 1000).toFixed(1)}s`
          }
          onClick={() => {
            if (locked) return
            // Shift-click always clears timer overlays — useful when both
            // overlays and an auto-advance plan are active.
            if (hasTimers && !advancing) {
              killTimers()
              return
            }
            if (!hasLive) return
            setAdvancing((v) => !v)
          }}
          disabled={!hasLive && !hasTimers}
          tone={advancing ? "warning" : "neutral"}
        >
          <ClockIcon className="size-3" />
        </ControlButton>
      </div>

      {/* Auto-advance bar — appears while advancing, lets operator dial
          the cadence on the fly. Spinning ring shows the loop is active. */}
      <AnimatePresence initial={false}>
        {advancing && (
          <motion.div
            key="advance-bar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 rounded bg-amber-500/10 px-2 py-1 ring-1 ring-amber-500/30">
              <ClockIcon className="size-3 shrink-0 animate-pulse text-amber-300" />
              <span className="text-[10px] uppercase tracking-wider text-amber-200/90">
                Every
              </span>
              <input
                type="number"
                step={0.5}
                min={0.5}
                value={(advanceMs / 1000).toFixed(1)}
                onChange={(e) => {
                  const s = parseFloat(e.target.value)
                  if (!Number.isFinite(s)) return
                  setAdvanceMs(Math.max(500, Math.round(s * 1000)))
                }}
                className="h-5 w-14 rounded border border-amber-500/30 bg-background/40 px-1.5 text-right text-[10px] tabular-nums outline-none focus-visible:border-amber-400"
              />
              <span className="text-[10px] text-amber-200/80">s</span>
              <button
                type="button"
                onClick={() => navigateNext()}
                title="Advance now"
                className="ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-100 transition-colors hover:bg-amber-500/20"
              >
                Skip
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ControlButton({
  label,
  onClick,
  disabled,
  tone = "neutral",
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: "neutral" | "danger" | "warning"
  children: React.ReactNode
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      whileHover={disabled ? undefined : { y: -1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      title={label}
      aria-label={label}
      className={cn(
        "grid h-7 flex-1 place-items-center rounded text-muted-foreground/80 transition-colors",
        disabled
          ? "cursor-not-allowed opacity-30"
          : tone === "danger"
            ? "hover:bg-destructive/20 hover:text-destructive"
            : tone === "warning"
              ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
              : "hover:bg-muted/40 hover:text-foreground"
      )}
    >
      {children}
    </motion.button>
  )
}

function OverlayLayer({ overlays }: { overlays: ActiveOverlay[] }) {
  if (overlays.length === 0) return null
  return (
    <div className="pointer-events-none absolute inset-0">
      <AnimatePresence initial={false}>
        {overlays.map((o) => (
          <OverlayInstance key={o.scheduleItemId} overlay={o} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function OverlayInstance({ overlay }: { overlay: ActiveOverlay }) {
  const def = widgetDef(overlay.overlayKind as WidgetKind)
  const layouts = useMemo(
    () => parseLayouts(overlay.layoutsJSON, def.defaultLayout),
    [overlay.layoutsJSON, def.defaultLayout]
  )
  // displayId 0 → no per-display override matches, so resolveLayout
  // hands back the default layout. That's what we want for the
  // preview widget, which isn't bound to a real display.
  const layout = resolveLayout(layouts, 0)
  const config = useMemo(
    () => parseConfig(overlay.configJSON, def.defaultConfig),
    [overlay.configJSON, def.defaultConfig]
  )
  const entry = layout.style.entry as AnimKind | undefined
  const duration = layout.style.duration_ms as number | undefined
  const m = motionProps(entry ?? "fade", duration)
  return (
    <motion.div
      {...m}
      className="absolute"
      style={{
        left: `${(layout.x - layout.w / 2) * 100}%`,
        top: `${(layout.y - layout.h / 2) * 100}%`,
        width: `${layout.w * 100}%`,
        height: `${layout.h * 100}%`,
        containerType: "size",
      }}
    >
      <def.Renderer
        config={config}
        style={layout.style}
        activatedAt={overlay.activatedAt}
      />
    </motion.div>
  )
}

function MediaTile({ mediaId, muted }: { mediaId: number; muted: boolean }) {
  // /media-asset/:id is served by the Go middleware. Image vs video
  // distinction isn't carried in the live payload, so probe with an
  // <img> that swaps to <video> on error. Simple, no extra fetch.
  const [isVideo, setIsVideo] = useState(false)
  if (isVideo) {
    return (
      <video
        src={`/media-asset/${mediaId}`}
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        loop
        muted={muted}
        playsInline
      />
    )
  }
  return (
    <img
      src={`/media-asset/${mediaId}`}
      alt=""
      className="absolute inset-0 h-full w-full object-cover"
      onError={() => setIsVideo(true)}
    />
  )
}
