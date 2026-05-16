import { useMemo } from "react"
import { Link } from "@tanstack/react-router"
import { AnimatePresence, motion } from "motion/react"
import { SettingsIcon } from "lucide-react"
import { useDisplays } from "@/features/displays/api"
import { useTemplates } from "@/features/library/templates-api"
import { useLive, type ActiveOverlay } from "@/features/live/live-context"
import { ScaledTemplate } from "@/features/templates/renderer"
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
import type { Display, Template } from "@/bindings/neoprojector/database"
import { cn } from "@/lib/utils"

// DisplayPreviewPane: stacked tiles, one per configured display. Each
// tile renders the currently-live slide through the template the
// display is bound to. With nothing live (or no binding), the tile is
// a blank surface. Display name + status overlay on hover only.
export function DisplayPreviewPane() {
  const { data: displays, isLoading } = useDisplays()
  const { data: templates } = useTemplates()
  const { live, activeOverlays } = useLive()

  // Index templates by id once so each tile can resolve its binding in
  // O(1). useTemplates returns defaults + DB rows merged, so negative
  // ids and positive ids both land in the same map.
  const templateById = useMemo(() => {
    const map = new Map<number, Template>()
    for (const t of templates ?? []) map.set(t.id, t)
    return map
  }, [templates])

  return (
    <div className="relative h-full w-full bg-background">
      <div className="pointer-events-none absolute left-3 top-2 z-10 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
        Preview
      </div>
      <div className="flex h-full flex-col pt-7">
        {isLoading ? (
          <div className="grid flex-1 place-items-center text-xs text-muted-foreground/60">
            Loading…
          </div>
        ) : !displays || displays.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-1 flex-col overflow-y-auto">
            {displays.map((d) => (
              <PreviewTile
                key={d.id}
                display={d}
                templateById={templateById}
                live={live}
                activeOverlays={activeOverlays}
              />
            ))}
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
          to="/settings"
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

function PreviewTile({
  display,
  templateById,
  live,
  activeOverlays,
}: {
  display: Display
  templateById: Map<number, Template>
  live: ReturnType<typeof useLive>["live"]
  activeOverlays: ActiveOverlay[]
}) {
  const enabled = display.enabled !== 0

  // Pick the binding that matches the live slide kind. Disabled
  // displays still show their tile so the operator sees the full
  // output set, just dimmed.
  const bindingId = live
    ? live.kind === "bible"
      ? display.bible_template_id.Valid
        ? display.bible_template_id.Int64
        : null
      : live.kind === "song"
        ? display.song_template_id.Valid
          ? display.song_template_id.Int64
          : null
        : null
    : null

  const template = bindingId !== null ? templateById.get(bindingId) ?? null : null
  const overlaysCoverSlide = activeOverlays.some((a) => {
    const def = widgetDef(a.overlayKind as WidgetKind)
    return parseRules(a.rulesJSON, def.defaultRules).cover_slide === true
  })

  return (
    <div
      className={cn(
        "group relative aspect-video w-full shrink-0",
        enabled ? "bg-muted/30" : "bg-muted/10"
      )}
    >
      {template && live && enabled && !overlaysCoverSlide ? (
        <ScaledTemplate
          template={template}
          fill={live.fill}
          measure={false}
          className="absolute inset-0 h-full w-full"
        />
      ) : null}
      {enabled && (
        <PreviewOverlays
          displayId={display.id}
          overlays={activeOverlays}
        />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-2 py-1 text-[10px] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <span className="truncate font-medium text-foreground">
          {display.name}
        </span>
        {!enabled ? (
          <span className="shrink-0 uppercase tracking-wider text-muted-foreground/80">
            Disabled
          </span>
        ) : !template && live ? (
          <span className="shrink-0 uppercase tracking-wider text-muted-foreground/80">
            No {live.kind} template
          </span>
        ) : null}
      </div>
    </div>
  )
}
