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
  resolveLayout,
  type WidgetKind,
} from "@/features/overlays/types"
import { routeOverlays } from "@/features/overlays/routing"
import {
  type MediaRef,
  type SlotFill,
  type SlotName,
} from "@/features/templates/types"
import { motionProps } from "@/features/animations/variants"
import type { AnimKind } from "@/features/animations/variants"
import {
  OverlayParts,
  staggerContainerVariants,
} from "@/features/overlays/stagger"
import { BackgroundView } from "@/features/backgrounds/background-view"
import { useVideoAssetUrl } from "@/lib/media-url"

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

  // On Windows the Go side creates this window hidden and only shows
  // (and fullscreens) it once this fires, so the projector never sees
  // the blank native window WebView2 sits in before its first paint.
  useEffect(() => {
    Events.Emit("output:ready")
  }, [])

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

  // Channel extraction. Each channel is independently nullable; the
  // window composites whatever is present, bottom-up.
  const slide = slot?.slide ?? null
  const mediaCh = slot?.media ?? null
  const presentation = slot?.presentation ?? null
  const background = slot?.background ?? null

  // Per-display routing: this window renders only the channels its
  // show_* flags allow. A suppressed channel blanks here exactly as
  // it does in the operator's preview tile. show_media gates the
  // whole z0 slot (media AND background) plus the z3 presentation
  // layer — a lyrics-only stage display wants none of them. The
  // flags live on the display row this window refetches on
  // displays:changed, so toggling routing takes effect mid-live with
  // no re-push.
  const overlaysShown = display ? display.show_overlay !== 0 : true
  const mediaShown = display ? display.show_media !== 0 : true
  const slideShown =
    !!slide &&
    (!display ||
      (slide.kind === "song"
        ? display.show_song !== 0
        : slide.kind === "bible"
          ? display.show_bible !== 0
          : true))

  const template = useMemo(() => {
    if (!display || !slide || !templates || !slideShown) return null
    const binding =
      slide.kind === "bible"
        ? display.bible_template_id
        : slide.kind === "song"
          ? display.song_template_id
          : null
    if (!binding?.Valid) return null
    return templates.find((t) => t.id === binding.Int64) ?? null
  }, [display, slide, templates, slideShown])

  // Convert the Go-side LiveFill (which has empty-string defaults for
  // every unset field) back into the frontend's optional-field SlotFill
  // so the template renderer's "secondary set?" checks behave correctly.
  const fill = useMemo<SlotFill>(() => {
    // Suppressed slide → empty fill so the templated path resolves to
    // a clean black surface.
    if (!slide || !slideShown) return {}
    const f: SlotFill = {}
    if (slide.fill.primary) f.primary = slide.fill.primary
    if (slide.fill.secondary) f.secondary = slide.fill.secondary
    if (slide.fill.tertiary) f.tertiary = slide.fill.tertiary
    if (slide.fill.caption) f.caption = slide.fill.caption
    if (slide.fill.media) {
      f.media = toMediaRef(slide.fill.media, slot?.audio_display_id ?? 0, id)
    }
    return f
  }, [slide, id, slideShown, slot?.audio_display_id])

  // slideKey identifies the current slide for the template crossfade;
  // when it changes the previous template exits and the new one enters
  // using the template's chosen transition.
  const slideKey = slide
    ? `${slide.kind}-${slide.source_item_id}-${slide.slide_index}`
    : "idle"

  // Operator's uniform-fit pass: single fontSize applied to every
  // fitToBox box in THIS display's bound template, across every
  // slide in the active item. Per-template scoping: a sibling display
  // bound to a different template doesn't drag our floor with it.
  const fontSizeOverride = useMemo<number | undefined>(() => {
    const raw = slide?.font_size_override_by_template
    if (!raw || !template) return undefined
    const v = raw[String(template.id)]
    if (typeof v !== "number" || v <= 0) return undefined
    return v
  }, [slide, template])

  // Per-display overlay routing: overlays targeted elsewhere drop out,
  // sticky ones render above everything. If any overlay here opts in
  // to cover_slide, the slide TEXT beneath is suppressed — a countdown
  // shouldn't have verses peeking through it. The z0 slot
  // (background/media) stays: overlays are transparent and render OVER
  // the resting layer, never on a forced black canvas.
  const routed = useMemo(
    () =>
      routeOverlays(
        overlaysShown ? slot?.active_overlays ?? [] : [],
        id,
        (a) => ({ kind: a.kind, rulesJSON: a.rules_json })
      ),
    [overlaysShown, slot?.active_overlays, id]
  )
  const overlaysCoverSlide = routed.coverSlide

  // z0 media + background refs.
  const z0MediaRef = useMemo<MediaRef | null>(() => {
    if (!mediaCh || !mediaShown) return null
    return toMediaRef(mediaCh.ref, slot?.audio_display_id ?? 0, id)
  }, [mediaCh, mediaShown, slot?.audio_display_id, id])
  // The background renders only when nothing opaque sits on the z0
  // slot or above it — an invisible gradflow canvas would still burn
  // GPU in every output window, so unmount instead of occlude.
  const backgroundVisible =
    mediaShown && !!background && !z0MediaRef && !presentation

  // z3 presentation media + transition.
  const presRef = useMemo<MediaRef | null>(() => {
    if (!presentation || !mediaShown) return null
    return toMediaRef(presentation.ref, slot?.audio_display_id ?? 0, id)
  }, [presentation, mediaShown, slot?.audio_display_id, id])
  const presTransition =
    presentation?.transition_kind && presentation.transition_kind !== ""
      ? {
          kind: presentation.transition_kind,
          duration_ms: presentation.transition_duration_ms ?? 500,
        }
      : undefined
  // Preload hint — the upcoming presentation slide's bytes get decoded
  // BEFORE the crossfade fires so N outputs don't stutter on the same
  // asset simultaneously.
  const nextMediaId = presentation?.next_media_id ?? 0

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* z0 — media item, else background, else the black canvas. */}
      {z0MediaRef ? (
        <DualLayerMediaCanvas
          mediaRef={z0MediaRef}
          nextMediaId={0}
          transition={undefined}
        />
      ) : backgroundVisible && background ? (
        <BackgroundView background={background} />
      ) : null}
      {/* z1 — overlays render above the resting layer, below text. */}
      <OverlayLayer displayId={id} overlays={routed.under} />
      {/* z2 — templated slide text (song/bible). Mounted whenever a
          slide channel exists — suppression blanks template+fill
          instead of unmounting, so a routing toggle hard-cuts in
          place identically on output and preview tile. */}
      {slide && (
        <LiveTemplateView
          template={overlaysCoverSlide ? null : template}
          fill={fill}
          slideKey={slideKey}
          fontSizeOverride={fontSizeOverride}
          transitionOverride={undefined}
          liveTransparency
        />
      )}
      {/* z3 — presentation covers everything while live. */}
      {presRef && (
        <DualLayerMediaCanvas
          mediaRef={presRef}
          nextMediaId={nextMediaId}
          transition={presTransition}
        />
      )}
      {/* Sticky overlays (e.g. the sermon timer) are pinned above
          every layer, presentations included. */}
      <OverlayLayer displayId={id} overlays={routed.top} />
      {mediaShown && <NextMediaWarmer mediaId={nextMediaId} />}
    </div>
  )
}

// toMediaRef converts the broadcast LiveMediaRef into the renderer's
// MediaRef, applying the single-audio-output rule: exactly one display
// (audio_display_id, picked Go-side at PushLive) emits audio; every
// other output mutes so N outputs don't stack N audio streams. The
// operator's mute toggle still wins — when muted, even the chosen
// display goes silent.
function toMediaRef(
  ref: {
    mediaId: number
    mode?: string
    playing: boolean
    loop: boolean
    muted: boolean
    restart_token: number
  },
  audioDisplayId: number,
  selfId: number
): MediaRef {
  return {
    mediaId: ref.mediaId,
    mode:
      ref.mode === "cover" || ref.mode === "contain" || ref.mode === "loop"
        ? ref.mode
        : undefined,
    playing: ref.playing,
    loop: ref.loop,
    muted: ref.muted || audioDisplayId !== selfId,
    restartToken: ref.restart_token,
  }
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
  const videoSrc = useVideoAssetUrl(
    item?.type === "video" && mediaId > 0 ? mediaId : undefined
  )
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
          src={videoSrc}
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
      ) : item?.type === "image" ? (
        // Images only once the type is known: an <img> pointed at a
        // video file makes the wails asset bridge buffer the whole file
        // on the UI thread (seconds-long freeze on a large video). The
        // black fallback below covers the moment the list is loading.
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
  const { data: list } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
    staleTime: 60_000,
  })
  const type = list?.find((m) => m.id === mediaId)?.type
  const isVideo = type === "video"
  const videoSrc = useVideoAssetUrl(isVideo ? mediaId : undefined)
  // Warm by real type only — an <img> on a video file goes through the
  // wails asset bridge and buffers the whole file on the UI thread.
  if (mediaId <= 0 || (type !== "image" && !isVideo)) return null
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
      {type === "image" && (
        <img src={`/media-asset/${mediaId}`} alt="" decoding="async" />
      )}
      {isVideo && <video
        src={videoSrc}
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
      />}
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
  // stagger_ms > 0 switches from whole-card motion to per-element:
  // the container only orchestrates while each <OverlayPart> the
  // widget declares runs the entry animation individually, then
  // peels off in reverse when the overlay leaves live.
  const entry = (layout.style.entry as AnimKind | undefined) ?? "fade"
  const duration = layout.style.duration_ms as number | undefined
  const staggerMs = (layout.style.stagger_ms as number | undefined) ?? 0
  const boxStyle: React.CSSProperties = {
    left: `${(layout.x - layout.w / 2) * 100}%`,
    top: `${(layout.y - layout.h / 2) * 100}%`,
    width: `${layout.w * 100}%`,
    height: `${layout.h * 100}%`,
    containerType: "size",
  }
  const content = (
    <def.Renderer
      config={config}
      style={layout.style}
      activatedAt={overlay.activated_at_ms}
    />
  )
  if (staggerMs > 0) {
    return (
      <motion.div
        initial="hidden"
        animate="visible"
        exit="hidden"
        variants={staggerContainerVariants(staggerMs)}
        className="absolute"
        style={boxStyle}
      >
        <OverlayParts kind={entry} durationMs={duration ?? 220}>
          {content}
        </OverlayParts>
      </motion.div>
    )
  }
  const m = motionProps(entry, duration)
  return (
    <motion.div {...m} className="absolute" style={boxStyle}>
      {content}
    </motion.div>
  )
}
