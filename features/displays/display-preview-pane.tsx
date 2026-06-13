import { useMemo, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import {
  SettingsIcon,
  MusicIcon,
  BookOpenIcon,
  ImageIcon,
  LayersIcon,
  Power,
  PowerOff,
  Slash,
  GripVerticalIcon,
  type LucideIcon,
} from "lucide-react"
import {
  useDisplays,
  useSetDisplayEnabled,
  useSetDisplayLayer,
  useReorderDisplays,
  type DisplayLayer,
} from "@/features/displays/api"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  VerticalSortable,
  useSortableRow,
  type DragEndEvent,
} from "@/features/schedule/sortable"
import { useTemplates } from "@/features/library/templates-api"
import {
  useLive,
  type ActiveOverlay,
  type LiveSlide,
} from "@/features/live/live-context"
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
  motionProps,
  type AnimKind,
} from "@/features/animations/variants"
import {
  OverlayParts,
  staggerContainerVariants,
} from "@/features/overlays/stagger"
import type { Display, Template } from "@/bindings/neoprojector/database"
import { BackgroundView } from "@/features/backgrounds/background-view"
import { cn } from "@/lib/utils"

// DisplayPreviewPane: stacked tiles, one per configured display. Each
// tile renders the currently-live slide through the template the
// display is bound to. With nothing live (or no binding), the tile is
// a blank surface. Display name + status overlay on hover only.
export function DisplayPreviewPane() {
  const { data: displays, isLoading } = useDisplays()
  const { data: templates } = useTemplates()
  const { live, activeOverlays, serviceBackground } = useLive()
  const reorderMut = useReorderDisplays()

  // Index templates by id once so each tile can resolve its binding in
  // O(1). useTemplates returns defaults + DB rows merged, so negative
  // ids and positive ids both land in the same map.
  const templateById = useMemo(() => {
    const map = new Map<number, Template>()
    for (const t of templates ?? []) map.set(t.id, t)
    return map
  }, [templates])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  // Reorder persists through the same useReorderDisplays mutation the
  // settings list uses, so dragging here writes display.position and
  // the two stay in lockstep — drag on the main page, see it in
  // settings and vice versa.
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || !displays || active.id === over.id) return
    const oldIdx = displays.findIndex((d) => `display-${d.id}` === active.id)
    const newIdx = displays.findIndex((d) => `display-${d.id}` === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const next = [...displays]
    const [moved] = next.splice(oldIdx, 1)
    next.splice(newIdx, 0, moved)
    reorderMut.mutate(next.map((d) => d.id))
  }

  return (
    <div className="relative h-full w-full bg-background">
      {/* No pane-level "Preview" label — each tile carries its own
          header now, so a stray title would just double up. */}
      <div className="flex h-full flex-col">
        {isLoading ? (
          <div className="grid flex-1 place-items-center text-xs text-muted-foreground/60">
            Loading…
          </div>
        ) : !displays || displays.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-1 flex-col overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <VerticalSortable ids={displays.map((d) => `display-${d.id}`)}>
                {displays.map((d) => (
                  <PreviewTile
                    key={d.id}
                    display={d}
                    templateById={templateById}
                    live={live}
                    activeOverlays={activeOverlays}
                    serviceBackground={serviceBackground}
                  />
                ))}
              </VerticalSortable>
            </DndContext>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="grid flex-1 place-items-center px-4">
      <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground/60">
        <span>No displays configured</span>
        <Link
          to="/"
          search={(prev) => ({ ...prev, surface: "settings" })}
          className="inline-flex items-center gap-1.5 text-xs text-foreground transition-colors hover:text-foreground/80"
        >
          <SettingsIcon className="size-3.5" />
          Configure displays
        </Link>
      </div>
    </div>
  )
}

// PreviewOverlays mirrors the output route's overlay stack inside the
// in-app preview tile so the operator sees the same composition the
// audience does. Same resolveLayout / widgetDef wiring; smaller box.
function PreviewOverlays({
  displayId,
  overlays,
}: {
  displayId: number
  overlays: ActiveOverlay[]
}) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <AnimatePresence initial={false}>
        {overlays.map((o) => (
          <PreviewOverlay
            key={o.scheduleItemId}
            displayId={displayId}
            overlay={o}
          />
        ))}
      </AnimatePresence>
    </div>
  )
}

function PreviewOverlay({
  displayId,
  overlay,
}: {
  displayId: number
  overlay: ActiveOverlay
}) {
  const def = widgetDef(overlay.overlayKind as WidgetKind)
  const layouts = useMemo(
    () => parseLayouts(overlay.layoutsJSON, def.defaultLayout),
    [overlay.layoutsJSON, def.defaultLayout]
  )
  const layout = resolveLayout(layouts, displayId)
  const config = useMemo(
    () => parseConfig(overlay.configJSON, def.defaultConfig),
    [overlay.configJSON, def.defaultConfig]
  )
  // Same stagger switch as the output's OverlayInstance — parity.
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
      activatedAt={overlay.activatedAt}
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

// The four routable content layers, in the order they sit in the hover
// pill. field points at the matching show_* flag on the Display row;
// layer is the string the Go SetDisplayLayer service switches on.
type LayerField = "show_song" | "show_bible" | "show_media" | "show_overlay"

// Per-action hover tints, mirroring the schedule item-list's color
// language (amber / sky / emerald / destructive) so the two surfaces
// feel like one app. Each layer owns a hue; the icons themselves also
// match the schedule's kind icons for consistency.
type ToneKey = "emerald" | "amber" | "sky" | "violet" | "destructive"

const TONE_HOVER: Record<ToneKey, string> = {
  emerald: "hover:bg-emerald-500/15 hover:text-emerald-500",
  amber: "hover:bg-amber-500/15 hover:text-amber-500",
  sky: "hover:bg-sky-500/15 hover:text-sky-500",
  violet: "hover:bg-violet-500/15 hover:text-violet-500",
  destructive: "hover:bg-destructive/15 hover:text-destructive",
}

const LAYER_BUTTONS: {
  layer: DisplayLayer
  field: LayerField
  icon: LucideIcon
  label: string
  tone: ToneKey
}[] = [
  { layer: "song", field: "show_song", icon: MusicIcon, label: "song lyrics", tone: "emerald" },
  { layer: "bible", field: "show_bible", icon: BookOpenIcon, label: "bible verses", tone: "amber" },
  { layer: "media", field: "show_media", icon: ImageIcon, label: "media", tone: "sky" },
  { layer: "overlay", field: "show_overlay", icon: LayersIcon, label: "overlays", tone: "violet" },
]

// Whether the currently-live kind is routed to this display. The
// overlay layer is orthogonal (it stacks regardless of the slide kind),
// so it isn't consulted here — show_overlay gates the overlay stack
// separately.
function liveKindShown(display: Display, kind: LiveSlide["kind"]): boolean {
  if (kind === "song") return display.show_song !== 0
  if (kind === "bible") return display.show_bible !== 0
  if (kind === "media") return display.show_media !== 0
  return true
}

function PreviewTile({
  display,
  templateById,
  live,
  activeOverlays,
  serviceBackground,
}: {
  display: Display
  templateById: Map<number, Template>
  live: ReturnType<typeof useLive>["live"]
  activeOverlays: ActiveOverlay[]
  serviceBackground: ReturnType<typeof useLive>["serviceBackground"]
}) {
  const enabled = display.enabled !== 0
  const setEnabled = useSetDisplayEnabled()
  const setLayer = useSetDisplayLayer()
  const { attributes, listeners, setNodeRef, style, isDragging } =
    useSortableRow(`display-${display.id}`)

  // Channel split — mirrors the output window's compositing exactly:
  //   z0 media ?? background, z1 overlays, z2 slide text, z3
  //   presentation. show_media gates z0 AND z3; show_song/show_bible
  //   gate z2 by slide kind; show_overlay gates z1.
  const slideLive = live?.channel === "slide" ? live : null
  const mediaLive = live?.channel === "media" ? live : null
  const presLive = live?.channel === "presentation" ? live : null

  const mediaShown = display.show_media !== 0
  const overlaysShown = display.show_overlay !== 0
  const slideShown = slideLive
    ? liveKindShown(display, slideLive.kind)
    : false

  // Template binding for the slide channel (bible/song). A suppressed
  // kind resolves to null so the tile falls back to its black surface.
  const bindingId =
    slideShown && slideLive
      ? slideLive.kind === "bible"
        ? display.bible_template_id.Valid
          ? display.bible_template_id.Int64
          : null
        : slideLive.kind === "song"
          ? display.song_template_id.Valid
            ? display.song_template_id.Int64
            : null
          : null
      : null

  const template = bindingId !== null ? templateById.get(bindingId) ?? null : null

  // cover_slide overlays blank the slide TEXT beneath them — the z0
  // slot (background/media) stays visible; overlays are transparent
  // and render over it. Only overlays that actually render on this
  // display can blank the text beneath them.
  const overlaysCoverSlide =
    overlaysShown &&
    activeOverlays.some((a) => {
      const def = widgetDef(a.overlayKind as WidgetKind)
      return parseRules(a.rulesJSON, def.defaultRules).cover_slide === true
    })

  // z0 background: item/section override composed over the service
  // default — identical derivation to buildPayload. Unmounted (not
  // occluded) when anything opaque covers it, so the preview's WebGL
  // cost mirrors the output's.
  const background = live?.background ?? serviceBackground ?? null
  const backgroundVisible =
    mediaShown && !!background && !mediaLive && !presLive

  // Slide layer: blank the fill (rather than changing keys) when
  // suppressed, so a routing toggle refreshes the layer in place — an
  // instant hard cut on both surfaces, never a preview-only crossfade.
  // Media/presentation layers UNMOUNT when suppressed or covered,
  // exactly as the output window unmounts its DualLayerMediaCanvas.
  const slideFill = slideShown ? slideLive?.fill ?? {} : {}
  const slideKey = slideLive
    ? `${slideLive.kind}-${slideLive.sourceItemId ?? "_"}-${slideLive.slideIndex}`
    : "idle"
  const mediaVisible = !!mediaLive && mediaShown
  const mediaKey = mediaLive
    ? `media-${mediaLive.sourceItemId ?? "_"}`
    : "idle"
  const presVisible = !!presLive && mediaShown
  const presKey = presLive
    ? `pres-${presLive.sourceItemId ?? "_"}-${presLive.slideIndex}`
    : "idle"

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group shrink-0 bg-black border-b border-border/50 last:border-b-0",
        isDragging && "relative z-10 opacity-80"
      )}
    >
      {/* Header strip: drag handle + display name on the left; action
          buttons on the right, docked like the top toolbar (flush
          full-height cells + hairline dividers) but hidden until the
          tile is hovered, then each tints to its own color — same
          reveal + tint language as the schedule item-list. */}
      <div className="flex h-7 items-stretch justify-between border-b border-border/50">
        <div className="flex min-w-0 items-center gap-0.5 pl-1 pr-2.5">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none grid size-5 shrink-0 place-items-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <GripVerticalIcon className="size-3" />
          </button>
          <span
            className={cn(
              "truncate text-[10px] font-medium uppercase tracking-wider",
              enabled ? "text-muted-foreground/70" : "text-muted-foreground/40"
            )}
          >
            {display.name}
          </span>
        </div>
        <div className="flex shrink-0 items-stretch opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="w-px bg-border/50" />
          <HeaderButton
            label={enabled ? "Disable output" : "Enable output"}
            tone={enabled ? "destructive" : "emerald"}
            disabled={setEnabled.isPending}
            onClick={() => setEnabled.mutate({ id: display.id, enabled: !enabled })}
          >
            {enabled ? (
              <Power className="size-3.5" />
            ) : (
              <PowerOff className="size-3.5" />
            )}
          </HeaderButton>
          <span className="w-px bg-border/50" />
          {LAYER_BUTTONS.map(({ layer, field, icon: Icon, label, tone }) => {
            const on = display[field] !== 0
            return (
              <HeaderButton
                key={layer}
                label={`${on ? "Hide" : "Show"} ${label} on this display`}
                tone={tone}
                dim={!on}
                disabled={setLayer.isPending}
                onClick={() => setLayer.mutate({ id: display.id, layer, on: !on })}
              >
                <Icon className="size-3.5" />
                {!on && (
                  <Slash className="absolute inset-0 m-auto size-4 text-muted-foreground/70" />
                )}
              </HeaderButton>
            )
          })}
        </div>
      </div>

      {/* 16:9 audience surface — true black so an idle or disabled
          output reads like a real dark screen. */}
      <div
        className={cn(
          "relative aspect-video w-full overflow-hidden bg-black",
          !enabled && "opacity-40"
        )}
      >
        {/* z0 — media item, else the resting background. */}
        {mediaVisible && mediaLive ? (
          <LiveTemplateView
            template={null}
            fill={mediaLive.fill}
            slideKey={mediaKey}
            liveTransparency
            className="absolute inset-0 h-full w-full"
          />
        ) : backgroundVisible && background ? (
          <BackgroundView background={background} />
        ) : null}
        {/* z1 — overlays sit above the resting layer, below text. */}
        {enabled && overlaysShown && (
          <PreviewOverlays displayId={display.id} overlays={activeOverlays} />
        )}
        {/* z2 — templated slide text. liveTransparency: the tile is an
            audience mirror, so transparent templates show the layers
            beneath (or true black), never the editor checker. */}
        {slideLive && (
          <LiveTemplateView
            template={overlaysCoverSlide ? null : template}
            fill={slideFill}
            slideKey={slideKey}
            fontSizeOverride={
              template
                ? slideLive.fontSizeOverrideByTemplate?.[template.id]
                : undefined
            }
            liveTransparency
            className="absolute inset-0 h-full w-full"
          />
        )}
        {/* z3 — presentation covers everything while live. */}
        {presVisible && presLive && (
          <LiveTemplateView
            template={null}
            fill={presLive.fill}
            slideKey={presKey}
            liveTransparency
            className="absolute inset-0 h-full w-full"
          />
        )}
      </div>
    </div>
  )
}

// HeaderButton is one icon button in a tile's header action strip, laid
// out like the top toolbar's controls — a flush, full-height cell with
// hairline dividers added by the caller — but borrowing the schedule
// item-list's resting/hover treatment: muted at rest, tinting to its
// tone color on hover. `dim` drops the resting icon a step (used for a
// routed-off layer, which the caller also marks with a Slash overlay).
function HeaderButton({
  label,
  tone,
  dim,
  disabled,
  onClick,
  children,
}: {
  label: string
  tone: ToneKey
  dim?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative grid w-7 place-items-center outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50",
        dim ? "text-muted-foreground/50" : "text-muted-foreground",
        TONE_HOVER[tone]
      )}
    >
      {children}
    </button>
  )
}
