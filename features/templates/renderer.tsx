import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useQuery } from "@tanstack/react-query"
import {
  DEFAULT_TRANSITION,
  parseTemplateBody,
  type Background,
  type Box,
  type MediaRef,
  type RichText,
  type SlotFill,
  type SlotName,
  type SlotValue,
  type Span,
  type TemplateBody,
} from "@/features/templates/types"
import { UI_FONT } from "@/features/templates/fonts"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { Medium } from "@/bindings/neoprojector/database"
import { useVideoAssetUrl } from "@/lib/media-url"
import { clockFrom, useSyncedPlayback, type PlayClock } from "@/lib/media-sync"

// ─────────────────────────────────────────────────────────────────────────────
// Public API
//
// <TemplateCanvas/> renders a template at its native viewport size
// (e.g. 1920×1080). The caller wraps it in a scaling container to fit
// whatever real space is available — thumbnail, editor canvas, output.
//
// Scale-to-fit utilities live below as helper hooks/components so a
// thumbnail in the Templates grid is one line away.
// ─────────────────────────────────────────────────────────────────────────────

export type RawTemplate = {
  id: number
  name: string
  kind: string
  viewport_w: number
  viewport_h: number
  data_json: string
}

type CanvasProps = {
  template: RawTemplate
  fill?: SlotFill
  /**
   * When true, fit-to-box DOM measurement runs after layout. Set false
   * for thumbnails where text is unreadable anyway — saves a render
   * pass per box. Default true.
   */
  measure?: boolean
  /**
   * Editor hooks. When `onSelectBox` is provided, each box becomes
   * clickable and the box matching `selectedBoxIndex` shows a selection
   * ring. Thumbnails leave both undefined for a pure render.
   *
   * `body` lets callers pass an already-parsed body (e.g. the editor's
   * working copy held in state). When omitted we parse from
   * template.data_json so consumers without local edits can keep
   * passing a Template row straight through.
   *
   * `scale` is the screen-px-per-native-px ratio of the surrounding
   * wrapper. When provided we use it to keep the transparent-checker
   * tiles at a constant screen size regardless of zoom — so a tile
   * thumbnail and a full-screen editor view both show the same
   * recognisable checker grid, never the muddy-grey "zoomed out" look.
   */
  selectedBoxIndex?: number
  onSelectBox?: (index: number) => void
  body?: TemplateBody
  scale?: number
  /**
   * When true, a transparent background renders as actual
   * transparency (lets whatever is underneath show through) instead
   * of the editor's checkerboard visualization. Set this on the
   * live output route so the audience doesn't see the checker.
   * Defaults to false so editor/library/preview keep the checker.
   */
  liveTransparency?: boolean
  /**
   * Uniform fontSize override applied to every fitToBox box in the
   * template. Single value — not per-slot — so that primary,
   * secondary, tertiary translation boxes (and any other fitToBox
   * box on the slide) all render at the same size. Used by the
   * uniform-fit pass: the show pane collects every box's measured
   * fit via `onFitComputed`, takes the min across every box and
   * every slide, and feeds it back here so the operator never sees
   * font jumps between verses or between translations.
   */
  fontSizeOverride?: number
  /**
   * Called once after each box has measured itself, with the final
   * fontSize it landed on. The show pane uses this to compute the
   * per-template minimum across every fitToBox box and every slide.
   */
  onFitComputed?: (slot: SlotName, fontSize: number) => void
}

export function TemplateCanvas({
  template,
  fill = {},
  measure = true,
  selectedBoxIndex,
  onSelectBox,
  body: bodyOverride,
  scale = 1,
  liveTransparency = false,
  fontSizeOverride,
  onFitComputed,
}: CanvasProps) {
  const body = bodyOverride ?? parseTemplateBody(template.data_json)
  const interactive = !!onSelectBox

  function handleCanvasMouseDown(e: React.MouseEvent) {
    // Clicking the canvas background (not a box) clears selection.
    if (!interactive) return
    if (e.target !== e.currentTarget) return
    onSelectBox?.(-1)
  }

  // Per-slide coordinator: every fitToBox box reports its measured
  // ownFit here. We take the min and feed it back to every box so the
  // boxes on THIS slide share one fontSize — primary/secondary/
  // tertiary translations stay aligned even when only one of them
  // would have needed to shrink. Reset when the fill changes (a new
  // slide is being rendered into this canvas) so a short slide
  // doesn't stay locked at the previous long slide's floor.
  //
  // Independent of the external `fontSizeOverride` (cross-slide
  // broadcast). When external is set, it wins — the show pane has
  // already computed the cross-slide min, which is <= our internal
  // min. When external is undefined, internal is what's used,
  // giving per-slide auto-shrink without cross-slide coupling.
  const [internalMin, setInternalMin] = useState<number | undefined>(undefined)
  const fillSig = useMemo(() => JSON.stringify(fill), [fill])
  useEffect(() => {
    setInternalMin(undefined)
  }, [fillSig, template.id])
  const handleFitComputed = useCallback(
    (slot: SlotName, fontSize: number) => {
      setInternalMin((prev) => {
        if (prev !== undefined && prev <= fontSize) return prev
        return fontSize
      })
      onFitComputed?.(slot, fontSize)
    },
    [onFitComputed]
  )

  const effectiveOverride = fontSizeOverride ?? internalMin

  return (
    <div
      onMouseDown={handleCanvasMouseDown}
      style={{
        position: "relative",
        width: template.viewport_w,
        height: template.viewport_h,
        overflow: "hidden",
      }}
    >
      {/* Templates are text — always transparent. The stored
          body.background is ignored (legacy data from when the editor
          offered solid/media backgrounds); the z0 background/media
          channel owns the pixels behind the text. Editor and
          thumbnails render the checker, live renders true
          transparency. fill.media (a media BOX slot) still renders —
          that's content, not background. */}
      <BackgroundLayer
        background={{ type: "transparent" }}
        fill={fill}
        scale={scale}
        liveTransparency={liveTransparency}
      />
      {body.boxes.map((box, i) => (
        <BoxRenderer
          key={i}
          box={box}
          value={resolveSlot(box, fill)}
          measure={measure}
          fontSizeOverride={effectiveOverride}
          onFitComputed={handleFitComputed}
          selected={selectedBoxIndex === i}
          interactive={interactive}
          onSelect={interactive ? () => onSelectBox?.(i) : undefined}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Scaling wrapper — fits a TemplateCanvas inside `containerW × containerH`
// while preserving aspect ratio. Used by thumbnails and full-screen
// previews alike.
// ─────────────────────────────────────────────────────────────────────────────

export function ScaledTemplate({
  template,
  fill,
  measure,
  selectedBoxIndex,
  onSelectBox,
  body,
  className,
  style,
  liveTransparency,
  fontSizeOverride,
  onFitComputed,
}: CanvasProps & { className?: string; style?: React.CSSProperties }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width === 0 || height === 0) return
      const s = Math.min(
        width / template.viewport_w,
        height / template.viewport_h
      )
      setScale(s)
    }
    update() // synchronous before first paint
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [template.viewport_w, template.viewport_h])

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: template.viewport_w,
          height: template.viewport_h,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        <TemplateCanvas
          template={template}
          fill={fill}
          measure={measure}
          selectedBoxIndex={selectedBoxIndex}
          onSelectBox={onSelectBox}
          body={body}
          scale={scale}
          liveTransparency={liveTransparency}
          fontSizeOverride={fontSizeOverride}
          onFitComputed={onFitComputed}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// LiveTemplateView — renders a slide with the template's configured
// transition. Whenever the live content changes (operator advances
// slides, jumps to a new bible reference, switches songs), the consumer
// passes a fresh `slideKey` and we crossfade the previous render into
// the new one using whatever duration the template's data_json declares.
//
// Implementation: two stacked layers, inline opacity + CSS transition,
// applied with setProperty('important') so the [data-no-anim] kill-
// switch can't override it. We previously tried the motion library
// (popLayout fixes, MotionConfig overrides, direct objects vs variants)
// — every approach produced an instant cut inside the output webview
// even after logs confirmed the key was changing. CSS is the bedrock;
// going through a JS animation library here costs us reliability for
// no real gain.
//
// Used by output windows AND in-app surfaces that mirror live state
// (display preview tiles). Consumers that render
// templates with static content should use ScaledTemplate directly.
// ─────────────────────────────────────────────────────────────────────────────

type Layer = {
  id: number
  slideKey: string
  template: RawTemplate | null
  fill: SlotFill
  empty: ReactNode | null
  // Mode is fixed at mount. "enter" runs a fade-in animation once.
  // "exit" runs a fade-out animation once. The component then settles
  // at the final opacity (fill: "forwards" on the Web Animations API
  // call). No further opacity changes happen on a Layer — for each
  // navigation we mint new Layer instances and let old ones be
  // unmounted by cleanup.
  mode: "enter" | "exit"
}

export function LiveTemplateView({
  template,
  fill,
  slideKey,
  liveTransparency,
  className,
  empty,
  fontSizeOverride,
  transitionOverride,
}: {
  template: RawTemplate | null | undefined
  fill: SlotFill
  slideKey: string | number
  liveTransparency?: boolean
  className?: string
  empty?: ReactNode
  // Uniform fontSize override for this template. When set, every
  // fitToBox box in the template renders at exactly this size —
  // primary/secondary/tertiary translation boxes stay aligned,
  // every verse in the active item renders at the same size.
  fontSizeOverride?: number
  // Optional transition override for THIS slide. Used by
  // presentations to broadcast their per-presentation transition
  // (the template default is used otherwise). Undefined = use the
  // template-declared transition.
  transitionOverride?: { kind: string; duration_ms: number }
}) {
  const transition = useMemo(() => {
    if (transitionOverride) return transitionOverride
    if (!template) return DEFAULT_TRANSITION
    return parseTemplateBody(template.data_json).transition ?? DEFAULT_TRANSITION
  }, [template, transitionOverride])
  const durationMs = transition.duration_ms

  // Two distinct state buckets:
  //   - `active`: the layer currently showing (or fading in to) the
  //     latest content. Replaced wholesale on every slide change.
  //   - `exiting`: snapshot clones of previously-active layers that
  //     are running their fade-out. They unmount themselves after the
  //     duration via a setTimeout.
  //
  // Each layer mounts with a fixed `mode` and runs its Web-Animations
  // -API animation exactly once on mount (see CrossfadeLayer below).
  // No two-render dance, no raf-batched flip, no CSS-transition guard.
  // This is the most reliable shape for "every slide animates."
  const idRef = useRef(1)
  const [active, setActive] = useState<Layer>(() => ({
    id: 0,
    slideKey: String(slideKey),
    template: template ?? null,
    fill,
    empty: empty ?? null,
    // Initial layer doesn't fade in — it's the starting state.
    // We tag it "exit" so on mount it animates 1→1 (a no-op via
    // CrossfadeLayer's instant-resolve branch).
    mode: "enter",
  }))
  const [exiting, setExiting] = useState<Layer[]>([])
  const lastSlideKeyRef = useRef(String(slideKey))
  // Snapshot the *current* active layer in a ref so the slideKey
  // effect can read it without including `active` in deps (which would
  // re-fire the effect every time we install a new active).
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    const newSlideKey = String(slideKey)
    if (lastSlideKeyRef.current === newSlideKey) {
      // Same slide — refresh active in place (e.g. media playback
      // state changed). No fresh layer mint, no animation.
      setActive((prev) => ({
        ...prev,
        template: template ?? null,
        fill,
        empty: empty ?? null,
      }))
      return
    }
    lastSlideKeyRef.current = newSlideKey
    const prevActive = activeRef.current
    // Clone the previous active as an exit layer (so it gets a fresh
    // id and its mode is now "exit" — that mounts as a NEW component
    // and the WAAPI fade-out fires from mount).
    const exitClone: Layer = {
      ...prevActive,
      id: idRef.current++,
      mode: "exit",
    }
    const nextActive: Layer = {
      id: idRef.current++,
      slideKey: newSlideKey,
      template: template ?? null,
      fill,
      empty: empty ?? null,
      mode: "enter",
    }
    setExiting((curr) => [...curr, exitClone])
    setActive(nextActive)
    // Drop this exit clone after the fade finishes. Setting a
    // generous buffer covers WAAPI completion + paint latency.
    setTimeout(() => {
      setExiting((curr) => curr.filter((l) => l.id !== exitClone.id))
    }, durationMs + 100)
  }, [slideKey, template, fill, empty, durationMs])

  return (
    <>
      {exiting.map((layer) => (
        <CrossfadeLayer
          key={layer.id}
          layer={layer}
          durationMs={durationMs}
          className={className}
          liveTransparency={liveTransparency}
          fontSizeOverride={fontSizeOverride}
        />
      ))}
      <CrossfadeLayer
        key={active.id}
        layer={active}
        durationMs={durationMs}
        className={className}
        liveTransparency={liveTransparency}
        fontSizeOverride={fontSizeOverride}
      />
    </>
  )
}

function CrossfadeLayer({
  layer,
  durationMs,
  className,
  liveTransparency,
  fontSizeOverride,
}: {
  layer: Layer
  durationMs: number
  className?: string
  liveTransparency?: boolean
  fontSizeOverride?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Fire the fade animation exactly once, at mount. Web Animations
  // API drives this directly — no CSS transitions, no raf-paired
  // state flips, no MotionGlobalConfig to fight. fill: "forwards"
  // keeps the element at the final opacity after the animation ends.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const keyframes =
      layer.mode === "enter"
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 1 }, { opacity: 0 }]
    el.animate(keyframes, {
      duration: durationMs,
      easing: "ease-in-out",
      fill: "forwards",
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Initial inline opacity matches the WAAPI starting frame so there's
  // no first-paint flash before the animation begins.
  const initialOpacity = layer.mode === "enter" ? 0 : 1

  return (
    <div
      ref={ref}
      className={className ?? "absolute inset-0"}
      style={{ opacity: initialOpacity, pointerEvents: "none" }}
    >
      {layer.template ? (
        <ScaledTemplate
          template={layer.template}
          fill={layer.fill}
          measure
          liveTransparency={liveTransparency}
          fontSizeOverride={fontSizeOverride}
          className="h-full w-full"
        />
      ) : layer.fill.media ? (
        // No template but a media fill → render the media bytes
        // directly as a full-bleed background. This is the path for
        // single-media schedule items and presentation slides, since
        // displays don't ship with a "media template" binding.
        <div className="absolute inset-0">
          <MediaSurface media={layer.fill.media} />
        </div>
      ) : (
        layer.empty
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Background
// ─────────────────────────────────────────────────────────────────────────────

function BackgroundLayer({
  background,
  fill,
  scale,
  liveTransparency,
}: {
  background: Background
  fill: SlotFill
  scale: number
  liveTransparency?: boolean
}) {
  // Slot-bound media for the `media` slot wins over the template's
  // declared background, when present and the template doesn't already
  // include media content of its own.
  const slotMedia = fill.media
  if (slotMedia) {
    return <MediaSurface media={slotMedia} />
  }

  if (background.type === "color") {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: background.value,
        }}
      />
    )
  }
  if (background.type === "media") {
    // Template-declared media background: no operator playback state
    // travels with this path, so we render a static media surface.
    // Defaults: image → cover; video → playing+looping muted; audio
    // → unsupported as a background (renders nothing).
    return (
      <MediaSurface
        media={{
          mediaId: background.mediaId,
          mode: background.mode,
          playing: true,
          loop: true,
          muted: true,
        }}
      />
    )
  }
  // Transparent on the live output: actually transparent — let the
  // output window's black canvas (or whatever sits underneath in the
  // editor preview chain) show through. The checker is an editor
  // affordance only; the audience should never see it.
  if (liveTransparency) {
    return null
  }
  // Transparent in the editor / library / previews: subtle theme-
  // aware checker pattern. The pattern size (one full repeat — two
  // visual tiles in each axis) is picked so two constraints hold
  // simultaneously:
  //   (1) the pattern lands close to ~28px on screen at any zoom
  //       (gives a visible ~14px-per-tile checker — never the muddy
  //       grey of an over-shrunken pattern).
  //   (2) the chosen native pattern size divides both viewport_w and
  //       viewport_h evenly, so no partial half-tiles overflow the
  //       canvas edges. We snap to the nearest divisor of
  //       gcd(viewport_w, viewport_h).
  const TARGET_PATTERN_SCREEN = 28
  const patternSize = pickCleanPatternSize(TARGET_PATTERN_SCREEN, scale)
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "var(--background)",
        backgroundImage:
          "repeating-conic-gradient(" +
          "color-mix(in oklch, var(--foreground) 7%, transparent) 0% 25%, " +
          "transparent 0% 50%)",
        backgroundSize: `${patternSize}px ${patternSize}px`,
      }}
    />
  )
}

// MediaSurface renders the actual media bytes for a slot-bound or
// template-declared media reference. Branches by media kind (image /
// video / audio / pdf), reading the kind from the cached media list
// — the operator-side library has already populated it, and output
// windows fetch the same list once on mount.
//
// Playback fields on MediaRef are operator-driven; this component is
// a controlled renderer that mirrors them imperatively to the video
// /audio element so the audience output stays in sync with whatever
// the operator clicked, with no autonomous playhead drift.
function MediaSurface({ media }: { media: MediaRef }) {
  const { data: list } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
    staleTime: 60_000,
  })
  const item = list?.find((m) => m.id === media.mediaId)
  const src = `/media-asset/${media.mediaId}`
  const videoSrc = useVideoAssetUrl(media.mediaId)
  // `mode` is overloaded: legacy values "cover"/"contain" map directly
  // to object-fit; "loop" is a legacy flag that meant "video should
  // loop" before the explicit `loop` boolean existed. We treat
  // anything that isn't "contain" as cover, and OR the legacy loop
  // hint into the explicit boolean.
  const objectFit: "cover" | "contain" =
    media.mode === "contain" ? "contain" : "cover"
  const wantLoop = !!media.loop || media.mode === "loop"
  const wantPlaying = media.playing !== false
  const wantMuted = !!media.muted

  // Type is unknown until the list resolves. Show a black surface in
  // that brief window rather than a debug stub — looks the same as a
  // pre-fade-in slide change.
  if (!item) {
    return <div style={{ position: "absolute", inset: 0, background: "#000" }} />
  }

  if (item.type === "image") {
    return (
      <img
        src={src}
        alt={item.title || ""}
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit,
        }}
      />
    )
  }

  if (item.type === "video") {
    return (
      <ControlledVideo
        src={videoSrc}
        playing={wantPlaying}
        loop={wantLoop}
        muted={wantMuted}
        restartToken={media.restartToken ?? 0}
        clock={clockFrom(media)}
        objectFit={objectFit}
      />
    )
  }

  if (item.type === "audio") {
    // Audio has no visual surface — fall through to a black canvas
    // so the bound template's text boxes still get a clean
    // background — and hand the playhead to ControlledAudio.
    return (
      <>
        <div style={{ position: "absolute", inset: 0, background: "#000" }} />
        <ControlledAudio
          src={videoSrc}
          playing={wantPlaying}
          loop={wantLoop}
          muted={wantMuted}
          restartToken={media.restartToken ?? 0}
          clock={clockFrom(media)}
        />
      </>
    )
  }

  // pdf and other future kinds: keep a discreet placeholder.
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background:
          "color-mix(in oklch, var(--foreground) 6%, var(--background))",
        color: "var(--muted-foreground)",
        display: "grid",
        placeItems: "center",
        fontSize: 24,
        fontFamily: "monospace",
      }}
    >
      {item.title || item.type}
    </div>
  )
}

function ControlledVideo({
  src,
  playing,
  loop,
  muted,
  restartToken,
  clock,
  objectFit,
}: {
  // Undefined until the loopback media-server info resolves (see
  // useVideoAssetUrl) — renders with no src briefly rather than
  // falling back to the wails-bridged path, which is exactly the
  // path this exists to avoid for video.
  src: string | undefined
  playing: boolean
  loop: boolean
  muted: boolean
  restartToken: number
  // Shared playhead; when set it owns position + play/pause so every
  // screen shows the same frame (lib/media-sync.ts).
  clock: PlayClock | null
  objectFit: "cover" | "contain"
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const lastRestart = useRef(restartToken)
  useSyncedPlayback(ref, clock)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.muted = muted
    el.loop = loop
    if (clock) return
    if (restartToken !== lastRestart.current) {
      lastRestart.current = restartToken
      el.currentTime = 0
    }
    el.muted = muted
    el.loop = loop
    if (playing) {
      // play() returns a promise that rejects when the browser
      // refuses (e.g. autoplay-with-sound). We always start muted-
      // capable so it will succeed; swallow rejection just in case.
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [playing, loop, muted, restartToken, clock])

  return (
    <video
      ref={ref}
      src={src}
      playsInline
      autoPlay={playing}
      muted={muted}
      loop={loop}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit,
        background: "#000",
      }}
    />
  )
}

function ControlledAudio({
  src,
  playing,
  loop,
  muted,
  restartToken,
  clock,
}: {
  // Undefined until the loopback media-server info resolves, same as
  // ControlledVideo — never the wails-bridged path.
  src: string | undefined
  playing: boolean
  loop: boolean
  muted: boolean
  restartToken: number
  clock: PlayClock | null
}) {
  const ref = useRef<HTMLAudioElement>(null)
  const lastRestart = useRef(restartToken)
  useSyncedPlayback(ref, clock)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.muted = muted
    el.loop = loop
    if (clock) return
    if (restartToken !== lastRestart.current) {
      lastRestart.current = restartToken
      el.currentTime = 0
    }
    if (playing) {
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }, [playing, loop, muted, restartToken, clock])

  return <audio ref={ref} src={src} autoPlay={playing} muted={muted} loop={loop} />
}

function pickCleanPatternSize(targetScreen: number, scale: number): number {
  // Divisors of gcd(1920, 1080) = 120, so every candidate produces
  // an integer count of pattern cells in both axes — clean tiling on
  // every edge of the canvas regardless of zoom. We pick the
  // candidate whose post-scale screen size sits closest to the
  // target, so visual density stays roughly constant.
  const CLEAN: readonly number[] = [
    8, 10, 12, 15, 20, 24, 30, 40, 60, 120,
  ]
  if (scale <= 0) return 60
  const ideal = targetScreen / scale
  let best = CLEAN[0]
  let bestDist = Math.abs(CLEAN[0] - ideal)
  for (const c of CLEAN) {
    const d = Math.abs(c - ideal)
    if (d < bestDist) {
      best = c
      bestDist = d
    }
  }
  return best
}

// ─────────────────────────────────────────────────────────────────────────────
// Box renderer + fit-to-box
//
// Strategy:
//   1. Render at the box's declared fontSize.
//   2. If `fitToBox` is true and the content overflows, shrink by 4px
//      increments down toward `fontSizeMin`.
//   3. If at `fontSizeMin` the content STILL overflows vertically,
//      expand the box upward — decrease its top, increase its height
//      by the same delta — so the full content fits without clipping.
//      Capped at the viewport top (y=0).
//
// Step 3 trades layout stability for legibility: super-long verses no
// longer chop off at the top/bottom of the box. We expand upward only
// (not downward) so the box's "anchor" stays at its original bottom
// edge — preserves the relationship to anything that comes below it
// (caption, next translation, etc.). Templates that sit close to the
// viewport top get less room to grow; that's a template-design
// constraint, not a renderer bug.
// ─────────────────────────────────────────────────────────────────────────────

function BoxRenderer({
  box,
  value,
  measure,
  fontSizeOverride,
  onFitComputed,
  selected,
  interactive,
  onSelect,
}: {
  box: Box
  value: SlotValue | undefined
  measure: boolean
  // When set, skip the entire fit-to-box pass and just render at this
  // size. The expand-top behaviour still runs if needed — overflow at
  // an externally-imposed size still needs to be handled.
  fontSizeOverride?: number
  // Reports the final fontSize this box landed on AFTER its own fit
  // (not called when fontSizeOverride is set — we didn't measure).
  onFitComputed?: (slot: SlotName, fontSize: number) => void
  selected?: boolean
  interactive?: boolean
  onSelect?: () => void
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(box.fontSize)
  const [expandUp, setExpandUp] = useState(0)

  // Track the last value we fitted against. When it changes the
  // expansion resets to 0 so a short verse following a long one
  // doesn't keep the long verse's grown box.
  const lastValueRef = useRef<SlotValue | undefined>(undefined)

  // fontsReadyTick increments whenever document.fonts finishes loading.
  // Drives a re-measurement: the first measure may run before the
  // template's custom font has loaded, falling back to system metrics
  // that are usually narrower. Text "fits" with fallback but overflows
  // with the real font — which is exactly the cutting the operator
  // was seeing. Forcing a re-measure after fonts settle eliminates
  // that mismatch.
  const [fontsReadyTick, setFontsReadyTick] = useState(0)
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) return
    let cancelled = false
    document.fonts.ready.then(() => {
      if (!cancelled) setFontsReadyTick((t) => t + 1)
    })
    const onLoadingDone = () => {
      if (!cancelled) setFontsReadyTick((t) => t + 1)
    }
    document.fonts.addEventListener("loadingdone", onLoadingDone)
    return () => {
      cancelled = true
      document.fonts.removeEventListener("loadingdone", onLoadingDone)
    }
  }, [])

  // Single layout effect: reset → measure → shrink → expand. All DOM
  // mutations happen directly here; React state syncs at the end so
  // the next render reflects the same values via JSX. Critically, we
  // do NOT include `fontSize` or `expandUp` in deps — they're outputs
  // of this effect, not inputs, and listing them would oscillate.
  useLayoutEffect(() => {
    if (!measure) return
    const el = innerRef.current
    if (!el) return
    const wrapper = el.parentElement as HTMLDivElement | null
    if (!wrapper) return

    const valueChanged = lastValueRef.current !== value
    lastValueRef.current = value

    // flexShrink:0 keeps the inner at its natural content height
    // so overflow is actually measurable.
    el.style.flexShrink = "0"

    // ALWAYS reset the wrapper to original dimensions before
    // measuring. If a previous render's expand-up grew the wrapper,
    // measuring ownFit against the expanded box would understate
    // the fit (text "fits" in the bigger box but actually needs to
    // shrink at the original size). Reset here, restore after.
    wrapper.style.top = `${box.y}px`
    wrapper.style.height = `${box.h}px`

    // Phase 1 — stepwise shrink until the content fits (or the floor
    // is reached). Each iteration drops fontSize by 2px and re-measures
    // overflow. The loop exits at the LARGEST fontSize that fits, so
    // a slide that needs to drop a little doesn't get yanked all the
    // way to fontSizeMin. That granularity matters per the user: if
    // a verse cuts we shrink by a point, recheck, and stop the moment
    // it fits — we don't slam every slide to the floor when only a
    // small adjustment was needed.
    //
    // Only fitToBox boxes participate; fitToBox=false boxes have a
    // fixed design size the author chose deliberately, and they
    // neither report nor accept overrides.
    let ownFit: number
    if (box.fitToBox) {
      el.style.fontSize = `${box.fontSize}px`
      const overflowsAt = () =>
        el.offsetHeight - wrapper.clientHeight > 0 ||
        el.scrollWidth - wrapper.clientWidth > 0
      ownFit = box.fontSize
      while (ownFit > box.fontSizeMin && overflowsAt()) {
        ownFit = Math.max(ownFit - 2, box.fontSizeMin)
        el.style.fontSize = `${ownFit}px`
      }
      // Tell the parent what size this box needs unconstrained. The
      // show pane aggregates the per-template minimum across every
      // fitToBox box and every slide.
      if (onFitComputed) onFitComputed(box.slot, ownFit)
    } else {
      ownFit = box.fontSize
    }

    // Phase 2 — apply the effective size. When an override is set on
    // a fitToBox slot, we use it DIRECTLY (not min(override, ownFit)).
    // The override is the broadcast minimum across the whole slide
    // set; the whole point of the uniform-fit pass is that every
    // slide renders at that same value, even if some happen to fit
    // at a larger size. Non-fit boxes ignore the override entirely —
    // their size is a design choice, not a fit target.
    const effective =
      box.fitToBox && fontSizeOverride !== undefined
        ? fontSizeOverride
        : ownFit
    el.style.fontSize = `${effective}px`

    // Phase 3 — expand-up whenever a fitToBox box's content overflows
    // at the effective size, regardless of whether we're at the floor.
    //
    // The original "atFloor" gate was too restrictive: when the uniform
    // override is applied across slides, the most-cramped slide drives
    // the broadcast value. If that value happens to land above the
    // template's fontSizeMin but the audience still measures overflow
    // (font-load timing, sub-pixel differences between the show-pane
    // tile webview and the output webview), the slide would cut.
    //
    // The user's invariant: "the font should not cut." So we expand
    // whenever overflow remains at the rendered size. Per-slide box
    // expansion is fine — short slides won't overflow, won't expand;
    // only the cutting slide grows its box upward. Capped at y=0 so
    // we never escape the viewport.
    let expand = valueChanged ? 0 : expandUp
    if (expand > 0) {
      wrapper.style.top = `${box.y - expand}px`
      wrapper.style.height = `${box.h + expand}px`
    }
    let safety = 20
    while (
      safety-- > 0 &&
      box.fitToBox &&
      el.offsetHeight - wrapper.clientHeight > 0 &&
      expand < Math.max(0, box.y)
    ) {
      const overflowPx = el.offsetHeight - wrapper.clientHeight + 8
      const next = Math.min(expand + overflowPx, Math.max(0, box.y))
      if (next === expand) break
      expand = next
      wrapper.style.top = `${box.y - expand}px`
      wrapper.style.height = `${box.h + expand}px`
    }

    if (valueChanged && typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[Fit]", {
        slot: box.slot,
        fitToBox: box.fitToBox,
        fontSize: {
          declared: box.fontSize,
          ownFit,
          effective,
          min: box.fontSizeMin,
          override: fontSizeOverride,
        },
        expand,
        innerHeight: el.offsetHeight,
        wrapperHeight: wrapper.clientHeight,
        boxH: box.h,
        boxY: box.y,
      })
    }

    if (effective !== fontSize) setFontSize(effective)
    if (expand !== expandUp) setExpandUp(expand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    box.fitToBox,
    box.fontSize,
    box.fontSizeMin,
    box.slot,
    box.y,
    box.h,
    value,
    measure,
    fontSizeOverride,
    fontsReadyTick,
  ])

  const justifyContent =
    box.vAlign === "top"
      ? "flex-start"
      : box.vAlign === "bottom"
        ? "flex-end"
        : "center"

  const isInteractive = interactive ?? !!onSelect

  return (
    <div
      onMouseDown={
        isInteractive
          ? (e) => {
              e.stopPropagation()
              onSelect?.()
            }
          : undefined
      }
      style={{
        position: "absolute",
        left: box.x,
        top: box.y - expandUp,
        width: box.w,
        height: box.h + expandUp,
        display: "flex",
        flexDirection: "column",
        justifyContent,
        overflow: "hidden",
        textAlign: box.align,
        cursor: isInteractive ? "pointer" : undefined,
        opacity: box.opacity,
        backgroundColor: box.bgColor,
        // Border draws inside the box (Tailwind preflight sets
        // box-sizing: border-box globally) so w/h stay authoritative.
        border:
          box.borderWidth && box.borderWidth > 0
            ? `${box.borderWidth}px solid ${box.borderColor ?? "#ffffff"}`
            : undefined,
        padding:
          box.paddingX || box.paddingY
            ? `${box.paddingY ?? 0}px ${box.paddingX ?? 0}px`
            : undefined,
        // Selection ring sits inside the box bounds via outline so it
        // doesn't shift layout. Sky-blue at full width (3px) reads
        // cleanly on dark and transparent backgrounds.
        outline: selected ? "3px solid rgb(56, 189, 248)" : undefined,
        outlineOffset: selected ? "-3px" : undefined,
      }}
    >
      {value !== undefined && value !== null ? (
        <div
          ref={innerRef}
          style={{
            // width:100% pins the inner to the wrapper's width so
            // text wraps within the box. Relying on the implicit
            // align-items:stretch behaviour was unreliable —
            // observed in the field: the inner rendered at its
            // natural content width (no wrap), text spilling
            // horizontally beyond the box and getting clipped on
            // both sides.
            width: "100%",
            // flexShrink:0 keeps the inner at its natural content
            // height instead of being squished to the parent's height.
            // Without this the inner's scrollHeight/clientHeight both
            // report the squished size and overflow can't be detected.
            // The wrapper's overflow:hidden still clips visually.
            flexShrink: 0,
            fontFamily: box.font,
            fontSize,
            fontWeight: box.weight,
            fontStyle: box.italic ? "italic" : "normal",
            color: box.color,
            lineHeight: box.lineHeight,
            textAlign: box.align,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            letterSpacing: box.letterSpacing ? `${box.letterSpacing}em` : undefined,
            textTransform: box.uppercase ? "uppercase" : undefined,
            textDecoration: box.underline ? "underline" : undefined,
            textShadow: box.shadow
              ? "0 2px 8px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.7)"
              : undefined,
            // Outline: stroke painted BEHIND the fill (paint-order)
            // so glyphs keep their full weight — a centered stroke
            // would eat into thin fonts. The behind-fill half is
            // hidden, so the stroke is doubled to make the configured
            // width mean "visible outline px". WebKit supports both.
            WebkitTextStroke:
              box.outlineWidth && box.outlineWidth > 0
                ? `${box.outlineWidth * 2}px ${box.outlineColor ?? "#000000"}`
                : undefined,
            paintOrder:
              box.outlineWidth && box.outlineWidth > 0 ? "stroke fill" : undefined,
          }}
        >
          {renderSlotValue(value)}
        </div>
      ) : isInteractive ? (
        // Editor affordance: empty boxes still show a faint slot
        // hint so the user can click into them.
        <div
          style={{
            margin: "auto",
            fontFamily: UI_FONT,
            fontSize: 22,
            color: "rgba(255,255,255,0.35)",
            fontStyle: "italic",
          }}
        >
          {box.slot}
        </div>
      ) : null}
    </div>
  )
}

function renderSlotValue(value: SlotValue): React.ReactNode {
  if (typeof value === "string") return value
  return value.map((span, i) => <SpanNode key={i} span={span} />)
}

function SpanNode({ span }: { span: Span }) {
  return (
    <span
      style={{
        fontWeight: span.bold ? 700 : undefined,
        fontStyle: span.italic ? "italic" : undefined,
        textDecoration:
          span.underline && span.strike
            ? "underline line-through"
            : span.underline
              ? "underline"
              : span.strike
                ? "line-through"
                : undefined,
        color: span.color,
        fontSize: span.sizeMul ? `${span.sizeMul}em` : undefined,
      }}
    >
      {span.text}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot resolution: live fill > box.defaultContent > undefined
// ─────────────────────────────────────────────────────────────────────────────

// Exported: the editor canvas resolves the same content to measure
// text minimums during box resize (clamping so the chosen font size
// never clips).
export function resolveSlot(box: Box, fill: SlotFill): SlotValue | undefined {
  const fromFill = fill[box.slot]
  if (fromFill !== undefined && !isMediaSlot(box.slot)) {
    return fromFill as SlotValue
  }
  if (box.defaultContent !== undefined && !isMediaSlot(box.slot)) {
    return box.defaultContent as SlotValue
  }
  return undefined
}

function isMediaSlot(slot: Box["slot"]): boolean {
  return slot === "media"
}

// Re-export for callers that want to roll their own canvas wrapper.
export type { TemplateBody, SlotFill }
