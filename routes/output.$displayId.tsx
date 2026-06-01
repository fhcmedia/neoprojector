import { useEffect, useMemo, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { Events } from "@wailsio/runtime"
import { Service as Displays } from "@/bindings/neoprojector/services/displays"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type {
  LivePayload,
  OverlayActivation,
} from "@/bindings/neoprojector/services/displays"
import type { Display, Medium } from "@/bindings/neoprojector/database"
import { useTemplates } from "@/features/library/templates-api"
import { LiveTemplateView } from "@/features/templates/renderer"
import { widgetDef } from "@/features/overlays/widgets"
import {
  parseConfig,
  parseLayouts,
  parseRules,
  resolveLayout,
  type WidgetKind,
} from "@/features/overlays/types"
import {
  type MediaRef,
  type SlotFill,
  type SlotName,
} from "@/features/templates/types"
import { motionProps } from "@/features/animations/variants"
import type { AnimKind } from "@/features/animations/variants"

// /output/$displayId is rendered inside each fullscreen secondary
// window opened by Displays.StartLive. It listens to the broadcast
// "live:slot" event, picks the template the display is bound to for
// that slide's kind, and renders it. Black surface when nothing live
// or no matching template.
export const Route = createFileRoute("/output/$displayId")({
  component: OutputWindow,
})

function OutputWindow() {
  const { displayId } = Route.useParams()
  const id = Number(displayId)
  const qc = useQueryClient()

  const { data: display } = useQuery({
    queryKey: ["displays", "by-id", id],
    queryFn: () => Displays.DisplayByID(id) as unknown as Promise<Display>,
    enabled: Number.isFinite(id),
  })
  const { data: templates } = useTemplates()

  // Cross-window invalidation: each output window is a separate
  // webview with its own React Query cache, so mutations in the main
  // window don't reach us through normal cache invalidation. The Go
  // side emits "displays:changed" whenever a display row is mutated;
  // refetching here lets template-binding swaps take effect mid-live
  // without the operator restarting Go Live.
  useEffect(() => {
    // Events.Off(name) in Wails v3 nukes every listener for that name,
    // including the one a second output window installed. Always call
    // the returned canceller so we only unsubscribe our own handler.
    const off = Events.On("displays:changed", () => {
      qc.invalidateQueries({ queryKey: ["displays", "by-id", id] })
      qc.invalidateQueries({ queryKey: ["templates"] })
    })
    return () => {
      off?.()
    }
  }, [qc, id])

  // Initial slot is fetched once on mount; subsequent updates arrive
  // via the live:slot event. The Go service caches the last payload
  // so this hydration always has the current state, even if the
  // window opened mid-broadcast.
  const [slot, setSlot] = useState<LivePayload | null>(null)
  useEffect(() => {
    let mounted = true
    Displays.CurrentLive().then((p) => {
      if (mounted) setSlot(p as unknown as LivePayload)
    })
    const off = Events.On("live:slot", (e: { data?: LivePayload }) => {
      if (e.data) setSlot(e.data)
    })
    return () => {
      mounted = false
      off?.()
    }
  }, [])

  // Per-display routing: this window renders only the live kinds its
  // show_* flags allow. A suppressed kind blanks to black here exactly
  // as it does in the operator's preview tile. The flags live on the
  // display row this window already refetches on displays:changed, so
  // toggling routing takes effect mid-live with no live re-push.
  const slideShown =
    !display || !slot || slot.kind === "none"
      ? true
      : slot.kind === "song"
        ? display.show_song !== 0
        : slot.kind === "bible"
          ? display.show_bible !== 0
          : slot.kind === "media"
            ? display.show_media !== 0
            : true
  const overlaysShown = display ? display.show_overlay !== 0 : true

  const template = useMemo(() => {
    if (!display || !slot || slot.kind === "none" || !templates) return null
    if (!slideShown) return null
    const binding =
      slot.kind === "bible"
        ? display.bible_template_id
        : slot.kind === "song"
          ? display.song_template_id
          : null
    if (!binding?.Valid) return null
    return templates.find((t) => t.id === binding.Int64) ?? null
  }, [display, slot, templates, slideShown])

  // Convert the Go-side LiveFill (which has empty-string defaults for
  // every unset field) back into the frontend's optional-field SlotFill
  // so the template renderer's "secondary set?" checks behave correctly.
  const fill = useMemo<SlotFill>(() => {
    // Suppressed kind → empty fill so both the media fast-path and the
    // templated path resolve to a clean black surface.
    if (!slot || !slideShown) return {}
    const f: SlotFill = {}
    if (slot.fill.primary) f.primary = slot.fill.primary
    if (slot.fill.secondary) f.secondary = slot.fill.secondary
    if (slot.fill.tertiary) f.tertiary = slot.fill.tertiary
    if (slot.fill.caption) f.caption = slot.fill.caption
    if (slot.fill.media) {
      const mode = slot.fill.media.mode
      f.media = {
        mediaId: slot.fill.media.mediaId,
        mode:
          mode === "cover" || mode === "contain" || mode === "loop"
            ? mode
            : undefined,
        playing: slot.fill.media.playing,
        loop: slot.fill.media.loop,
        // Exactly one output emits audio — the display whose id Go
        // tagged as audio_display_id (smallest active id, picked at
        // PushLive time). Every other output mutes so N displays
        // presenting the same video don't pile up N parallel audio
        // streams on the computer's audio device. The operator's
        // mute toggle still flows through the broadcast `muted` field
        // — when the operator mutes, even the chosen display goes
        // silent.
        muted: slot.fill.media.muted || slot.audio_display_id !== id,
        restartToken: slot.fill.media.restart_token,
      }
    }
    return f
  }, [slot, id, slideShown])

  // slideKey identifies the current slide for AnimatePresence; when
  // it changes the previous template exits and the new one enters
  // using the template's chosen transition.
  const slideKey = slot
    ? `${slot.kind}-${slot.source_item_id}-${slot.slide_index}`
    : "idle"

  // Operator's uniform-fit pass: single fontSize applied to every
  // fitToBox box in THIS display's bound template, across every
  // slide in the active item. Undefined unless the show pane has
  // reported measurements. The show pane measures each enabled
  // display's template independently and computes one minimum
  // across every (slide × fitToBox box) — so primary/secondary/
  // tertiary translations all render at the same size.
  //
  // Per-template scoping: a sibling display bound to a different
  // template doesn't drag our floor with it.
  const fontSizeOverride = useMemo<number | undefined>(() => {
    const raw = slot?.font_size_override_by_template
    if (!raw || !template) return undefined
    const v = raw[String(template.id)]
    if (typeof v !== "number" || v <= 0) return undefined
    return v
  }, [slot, template])

  // If any active overlay's rules opt in to cover_slide, the
  // template below is suppressed entirely — used by countdowns /
  // pre-service screens that own the canvas. Without that gate,
  // the audience would see verses peek through a centered timer.
  // parseRules takes the widget kind's defaults as fallback so old
  // rows (rules_json empty/{}) still get sensible behavior.
  // Only overlays that actually render on this display can blank the
  // slide beneath them. A screen routed to hide overlays keeps its
  // slide, so cover_slide can't reach across the routing toggle.
  const overlaysCoverSlide =
    overlaysShown &&
    (slot?.active_overlays ?? []).some((a) => {
      const def = widgetDef(a.kind as WidgetKind)
      return parseRules(a.rules_json, def.defaultRules).cover_slide === true
    })

  // Transition override from the broadcast. Set for presentation
  // playback (operator picked a per-presentation transition);
  // empty/zero means "use the template default" so bible/song stay
  // on their template-defined fade.
  const transitionOverride =
    slot?.transition_kind && slot.transition_kind !== ""
      ? {
          kind: slot.transition_kind,
          duration_ms: slot.transition_duration_ms ?? 500,
        }
      : undefined

  // Preload hint — a hidden <img>/<video> kept off-screen so the
  // browser fetches+decodes the upcoming slide's bytes BEFORE the
  // crossfade fires. Without this, 5+ outputs all hitting the same
  // /media-asset URL at slide-change time produces visible stutter
  // while each window decodes the asset from scratch. Type is
  // unknown until the media list is loaded by MediaSurface; we eagerly
  // render both <img> and <video> for the same src and let the
  // browser ignore the wrong one — cheap and dependency-free.
  const nextMediaId = slot?.next_media_id ?? 0

  // Media-only fast path. When the live slot has no template binding
  // (presentations + single-media items), the dual-layer canvas
  // ping-pongs persistent <video>/<img> elements so the decoder
  // doesn't spin up cold on every slide change. With 5+ outputs all
  // mounting fresh elements at the same broadcast we were seeing the
  // tail-window stutter the operator reported. Templated slides
  // (bible, song) keep using LiveTemplateView — their crossfade is
  // mostly text/SVG which doesn't suffer the same decoder cost.
  const useFastPath =
    !overlaysCoverSlide && !template && !!fill.media

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {useFastPath && fill.media ? (
        <DualLayerMediaCanvas
          mediaRef={fill.media}
          nextMediaId={nextMediaId}
          transition={transitionOverride}
        />
      ) : (
        <LiveTemplateView
          template={overlaysCoverSlide ? null : template}
          fill={fill}
          slideKey={slideKey}
          fontSizeOverride={fontSizeOverride}
          transitionOverride={transitionOverride}
          liveTransparency
        />
      )}
      <OverlayLayer
        displayId={id}
        overlays={overlaysShown ? slot?.active_overlays ?? [] : []}
      />
      {!useFastPath && display?.show_media !== 0 && (
        <NextMediaWarmer mediaId={nextMediaId} />
      )}
    </div>
  )
}

// DualLayerMediaCanvas keeps two media slots mounted at all times.
// Slot A holds the visible media; slot B holds the upcoming media id
// (next_media_id from the broadcast) preloaded and decoder-warm.
// When the broadcast switches to what was queued, we just swap which
// slot is visible — no <video>/<img> remount, no fresh decoder spin
// up, no black frame. The previous "next" gets recycled into the now-
// hidden slot ready for the slide after that.
//
// Falls back to a cold swap if the new live media wasn't in the
// preloaded slot (e.g. operator clicked an out-of-order tile). The
// cold swap blanks briefly but is no worse than what LiveTemplateView
// did before this fast path existed.
function DualLayerMediaCanvas({
  mediaRef,
  nextMediaId,
  transition,
}: {
  mediaRef: MediaRef
  nextMediaId: number
  transition: { kind: string; duration_ms: number } | undefined
}) {
  const durationMs = transition?.duration_ms ?? 500
  // Slot state: each slot holds the media id it's currently displaying
  // (or pre-decoding). visibleSlot says which one is currently in
  // front. A and B trade off on every slide change so neither has to
  // unmount.
  const [slotA, setSlotA] = useState<{ mediaId: number }>(() => ({
    mediaId: mediaRef.mediaId,
  }))
  const [slotB, setSlotB] = useState<{ mediaId: number }>(() => ({
    mediaId: nextMediaId > 0 ? nextMediaId : 0,
  }))
  const [visible, setVisible] = useState<"A" | "B">("A")
  const lastLiveId = useRef(mediaRef.mediaId)

  // React to the live mediaId changing. Three cases:
  //   - same: just a playback-state ping, nothing to do here.
  //   - matches the hidden slot: ideal — flip visibility.
  //   - matches neither: cold swap into the hidden slot, then flip.
  useEffect(() => {
    if (mediaRef.mediaId === lastLiveId.current) return
    lastLiveId.current = mediaRef.mediaId
    const hidden: "A" | "B" = visible === "A" ? "B" : "A"
    const hiddenId = hidden === "A" ? slotA.mediaId : slotB.mediaId
    if (mediaRef.mediaId === hiddenId) {
      setVisible(hidden)
      return
    }
    // Cold swap path: load new media into the hidden slot, then on
    // next paint flip. The flip is on rAF so the new src has at
    // least one paint to start decoding before the fade begins.
    if (hidden === "A") setSlotA({ mediaId: mediaRef.mediaId })
    else setSlotB({ mediaId: mediaRef.mediaId })
    requestAnimationFrame(() => setVisible(hidden))
  }, [mediaRef.mediaId, visible, slotA.mediaId, slotB.mediaId])

  // Keep the hidden slot pointed at the upcoming next slide id so
  // its decoder is ready by the time the operator (or auto-advance)
  // pushes that media live. Only updates the hidden slot — the
  // visible one keeps showing its content uninterrupted.
  useEffect(() => {
    if (nextMediaId <= 0) return
    const hidden: "A" | "B" = visible === "A" ? "B" : "A"
    const hiddenId = hidden === "A" ? slotA.mediaId : slotB.mediaId
    if (nextMediaId === hiddenId) return
    if (hidden === "A") setSlotA({ mediaId: nextMediaId })
    else setSlotB({ mediaId: nextMediaId })
  }, [nextMediaId, visible, slotA.mediaId, slotB.mediaId])

  return (
    <>
      <MediaLayer
        mediaId={slotA.mediaId}
        live={visible === "A" ? mediaRef : undefined}
        durationMs={durationMs}
      />
      <MediaLayer
        mediaId={slotB.mediaId}
        live={visible === "B" ? mediaRef : undefined}
        durationMs={durationMs}
      />
    </>
  )
}

// MediaLayer is one of the two persistent layers in the dual buffer.
// When `live` is set, it's the visible/foreground layer — apply the
// operator's playback state and animate to full opacity. When `live`
// is undefined, the layer is the hidden preload: paused, muted, no
// audio, opacity 0 — kept mounted purely so its decoder stays warm.
function MediaLayer({
  mediaId,
  live,
  durationMs,
}: {
  mediaId: number
  live: MediaRef | undefined
  durationMs: number
}) {
  const { data: list } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
    staleTime: 60_000,
  })
  const item = list?.find((m) => m.id === mediaId)
  const isVisible = !!live
  const lastRestart = useRef(live?.restartToken ?? 0)
  const videoRef = useRef<HTMLVideoElement>(null)

  // Imperatively sync playback state to the visible layer's video
  // element. The hidden layer parks at frame ~0.1s, muted, paused.
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    if (item?.type !== "video") return
    if (!live) {
      // Hidden — keep decoder warm by holding a decoded frame.
      el.muted = true
      el.pause()
      return
    }
    if (live.restartToken !== undefined && live.restartToken !== lastRestart.current) {
      lastRestart.current = live.restartToken
      el.currentTime = 0
    }
    el.muted = !!live.muted
    el.loop = !!live.loop
    if (live.playing !== false) {
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [live, item])

  const src = mediaId > 0 ? `/media-asset/${mediaId}` : undefined
  const objectFit =
    live?.mode === "contain" ? "contain" : "cover"

  if (!src) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#000",
          opacity: isVisible ? 1 : 0,
          transition: `opacity ${durationMs}ms ease-in-out`,
        }}
      />
    )
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: isVisible ? 1 : 0,
        transition: `opacity ${durationMs}ms ease-in-out`,
        // Promote to its own compositor layer so the opacity tween is
        // pure GPU work — no layout, no paint, no decoder thrash.
        willChange: "opacity",
      }}
    >
      {item?.type === "video" ? (
        <video
          ref={videoRef}
          src={src}
          playsInline
          muted={!live || !!live.muted}
          preload="auto"
          // First mount auto-plays muted so the decoder warms. The
          // useEffect above takes over once live arrives.
          autoPlay
          onLoadedMetadata={(e) => {
            if (live) return
            const el = e.currentTarget
            const t = Math.min(0.1, Math.max(0, (el.duration || 0) - 0.05))
            if (Number.isFinite(t) && t > 0) el.currentTime = t
            el.pause()
          }}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit,
          }}
        />
      ) : item?.type === "image" || !item ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit,
          }}
        />
      ) : (
        <div style={{ position: "absolute", inset: 0, background: "#000" }} />
      )}
    </div>
  )
}

// NextMediaWarmer forces actual decode of the upcoming slide's bytes
// — preload="auto" only buffers bytes; the decoder spins up cold when
// the visible <video> is mounted at slide-change time. With N output
// windows all opening a fresh decoder at once we see the lag the
// operator hits.
//
// The trick: keep this element mounted across slide changes (it lives
// on the OUTPUT route, outside the crossfade tree). For images, an
// <img> mounted alone is enough — once decode-on-paint runs the
// decoded bitmap stays in the image-decode cache. For videos, we
// autoPlay muted so the decoder spins up, then immediately pause and
// hold at frame ~0.1s so it's primed without burning CPU on continuous
// playback. The visible <video> will create a new element on slide
// change, but the HTTP cache + warmed codec path makes the cold start
// much shorter than from-scratch.
function NextMediaWarmer({ mediaId }: { mediaId: number }) {
  if (mediaId <= 0) return null
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: -100000,
        top: -100000,
        width: 2,
        height: 2,
        pointerEvents: "none",
        opacity: 0,
      }}
    >
      <img src={`/media-asset/${mediaId}`} alt="" decoding="async" />
      <video
        src={`/media-asset/${mediaId}`}
        preload="auto"
        muted
        autoPlay
        playsInline
        onLoadedMetadata={(e) => {
          const el = e.currentTarget
          // Seek a hair past 0 so the first keyframe + decode pipeline
          // actually runs. Pause so we don't pin the GPU on continuous
          // hidden playback across N output windows.
          const t = Math.min(0.1, Math.max(0, (el.duration || 0) - 0.05))
          if (Number.isFinite(t) && t > 0) el.currentTime = t
          el.pause()
        }}
      />
    </div>
  )
}

// OverlayLayer stacks every active overlay on top of the bound
// template. Each overlay resolves its layout against the current
// display id (per-display override if present, default otherwise)
// and renders the registered widget with activatedAt anchored to
// the operator's click. AnimatePresence carries exit animations
// for kinds that have them (e.g. name card sliding back out).
function OverlayLayer({
  displayId,
  overlays,
}: {
  displayId: number
  overlays: OverlayActivation[]
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <AnimatePresence initial={false}>
        {overlays.map((o) => (
          <OverlayInstance key={o.schedule_item_id} displayId={displayId} overlay={o} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function OverlayInstance({
  displayId,
  overlay,
}: {
  displayId: number
  overlay: OverlayActivation
}) {
  const def = widgetDef(overlay.kind as WidgetKind)
  const layouts = useMemo(
    () => parseLayouts(overlay.layouts_json, def.defaultLayout),
    [overlay.layouts_json, def.defaultLayout]
  )
  const layout = resolveLayout(layouts, displayId)
  const config = useMemo(
    () => parseConfig(overlay.config_json, def.defaultConfig),
    [overlay.config_json, def.defaultConfig]
  )
  // Motion is sourced from the layout's style (entry/exit/duration).
  // Defaults come from widgets.tsx — each kind ships a sensible
  // animation that the operator can override per overlay / per
  // display layout in the editor.
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
        activatedAt={overlay.activated_at_ms}
      />
    </motion.div>
  )
}
