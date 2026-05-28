import { useEffect, useMemo, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { Events } from "@wailsio/runtime"
import { Service as Displays } from "@/bindings/neoprojector/services/displays"
import type {
  LivePayload,
  OverlayActivation,
} from "@/bindings/neoprojector/services/displays"
import type { Display } from "@/bindings/neoprojector/database"
import { useTemplates } from "@/features/library/templates-api"
import { BackgroundLayer, LiveTemplateView } from "@/features/templates/renderer"
import { widgetDef } from "@/features/overlays/widgets"
import {
  parseConfig,
  parseLayouts,
  parseRules,
  resolveLayout,
  type WidgetKind,
} from "@/features/overlays/types"
import { type SlotFill, type SlotName } from "@/features/templates/types"
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

  const template = useMemo(() => {
    if (!display || !slot || slot.kind === "none" || !templates) return null
    const binding =
      slot.kind === "bible"
        ? display.bible_template_id
        : slot.kind === "song"
          ? display.song_template_id
          : null
    if (!binding?.Valid) return null
    return templates.find((t) => t.id === binding.Int64) ?? null
  }, [display, slot, templates])

  // Convert the Go-side LiveFill (which has empty-string defaults for
  // every unset field) back into the frontend's optional-field SlotFill
  // so the template renderer's "secondary set?" checks behave correctly.
  const fill = useMemo<SlotFill>(() => {
    if (!slot) return {}
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
        muted: slot.fill.media.muted,
        restartToken: slot.fill.media.restart_token,
      }
    }
    return f
  }, [slot])

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
  const overlaysCoverSlide = (slot?.active_overlays ?? []).some((a) => {
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

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <LiveTemplateView
        template={overlaysCoverSlide ? null : template}
        fill={fill}
        slideKey={slideKey}
        fontSizeOverride={fontSizeOverride}
        transitionOverride={transitionOverride}
        liveTransparency
      />
      <OverlayBackgroundsLayer overlays={slot?.active_overlays ?? []} />
      <OverlayLayer displayId={id} overlays={slot?.active_overlays ?? []} />
    </div>
  )
}

// OverlayBackgroundsLayer paints each active overlay's optional
// layouts.background as a full-canvas surface beneath the widget
// pane. Stacked in activation order — when multiple overlays declare
// a background, the later one wins visually. Most commonly there is
// only one cover_slide overlay active at a time.
function OverlayBackgroundsLayer({
  overlays,
}: {
  overlays: OverlayActivation[]
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {overlays.map((o) => {
        const def = widgetDef(o.kind as WidgetKind)
        const layouts = parseLayouts(o.layouts_json, def.defaultLayout)
        if (!layouts.background) return null
        return (
          <div key={o.schedule_item_id} className="absolute inset-0">
            <BackgroundLayer
              background={layouts.background}
              fill={{}}
              scale={1}
              liveTransparency
            />
          </div>
        )
      })}
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
