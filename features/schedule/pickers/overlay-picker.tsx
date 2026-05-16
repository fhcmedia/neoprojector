import { useMemo, useState } from "react"
import { ArrowLeftIcon, CheckIcon } from "lucide-react"
import { useOverlays } from "@/features/overlays/api"
import { useAddOverlayItem } from "@/features/schedule/api"
import { widgetDef } from "@/features/overlays/widgets"
import {
  parseConfig,
  parseLayouts,
  type WidgetKind,
} from "@/features/overlays/types"
import type { Overlay } from "@/bindings/neoprojector/database"
import { cn } from "@/lib/utils"

type Props = {
  sectionId: number
  onAdded: (newItemId?: number) => void
}

// OverlayPicker: two-stage flow. Stage 1 lists library overlays as
// tile previews (same look as the library tab). Stage 2 opens the
// kind's ConfigEditor seeded from the picked overlay so the operator
// can tweak the per-instance properties (countdown duration, name
// card text, sermon limit) before adding to the schedule. On save we
// snapshot config + layouts into a service_item_overlay row — future
// edits to the library overlay don't reach back into this snapshot.
export function OverlayPicker({ sectionId, onAdded }: Props) {
  const { data: overlays, isLoading } = useOverlays()
  const addMut = useAddOverlayItem(sectionId)
  const [picked, setPicked] = useState<Overlay | null>(null)

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/40">
        Loading…
      </div>
    )
  }

  if (picked) {
    return (
      <ConfigureStep
        overlay={picked}
        onBack={() => setPicked(null)}
        onSave={(configJSON) => {
          addMut.mutate(
            {
              kind: picked.kind,
              name: picked.name,
              config_json: configJSON,
              layouts_json: picked.layouts_json,
              rules_json: picked.rules_json,
            },
            { onSuccess: (item) => onAdded(item.id) }
          )
        }}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 p-2">
        {(overlays ?? []).map((o) => (
          <OverlayPickTile
            key={o.id}
            overlay={o}
            onPick={() => setPicked(o)}
          />
        ))}
      </div>
    </div>
  )
}

function OverlayPickTile({
  overlay,
  onPick,
}: {
  overlay: Overlay
  onPick: () => void
}) {
  const def = widgetDef(overlay.kind as WidgetKind)
  const config = useMemo(
    () => parseConfig(overlay.config_json, def.defaultConfig),
    [overlay.config_json, def.defaultConfig]
  )
  const layouts = useMemo(
    () => parseLayouts(overlay.layouts_json, def.defaultLayout),
    [overlay.layouts_json, def.defaultLayout]
  )
  const layout = layouts.default

  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex flex-col overflow-hidden rounded border border-border/50 bg-background transition-colors hover:border-border"
    >
      <div className="relative block aspect-video w-full bg-black">
        <div className="absolute inset-0">
          <div
            className="absolute"
            style={{
              left: `${(layout.x - layout.w / 2) * 100}%`,
              top: `${(layout.y - layout.h / 2) * 100}%`,
              width: `${layout.w * 100}%`,
              height: `${layout.h * 100}%`,
              containerType: "size",
            }}
          >
            <def.Renderer config={config} style={layout.style} />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 border-t border-border/40 px-2 py-1.5 text-left">
        <span className="truncate text-[11px] font-medium text-foreground">
          {overlay.name}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
          {def.label}
        </span>
      </div>
    </button>
  )
}

// ConfigureStep: edit the per-instance config before adding. Seeds
// from the picked library overlay's config; layouts come along
// snapshotted in the parent's onSave call.
function ConfigureStep({
  overlay,
  onBack,
  onSave,
}: {
  overlay: Overlay
  onBack: () => void
  onSave: (configJSON: string) => void
}) {
  const def = widgetDef(overlay.kind as WidgetKind)
  const layouts = useMemo(
    () => parseLayouts(overlay.layouts_json, def.defaultLayout),
    [overlay.layouts_json, def.defaultLayout]
  )
  const [config, setConfig] = useState(() =>
    parseConfig(overlay.config_json, def.defaultConfig)
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2 py-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="text-xs font-medium">{overlay.name}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {def.label}
        </span>
      </div>
      <div className="relative shrink-0 border-b border-border/40 bg-black">
        <div className="relative mx-auto aspect-video w-full max-w-[320px]">
          <div className="absolute inset-0">
            <div
              className="absolute"
              style={{
                left: `${(layouts.default.x - layouts.default.w / 2) * 100}%`,
                top: `${(layouts.default.y - layouts.default.h / 2) * 100}%`,
                width: `${layouts.default.w * 100}%`,
                height: `${layouts.default.h * 100}%`,
                containerType: "size",
              }}
            >
              {/* Live preview: pass activatedAt=now so countdowns and
                  sermon timers tick visibly while the operator dials
                  in the value. */}
              <def.Renderer
                config={config}
                style={layouts.default.style}
                activatedAt={Date.now()}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <def.ConfigEditor config={config} onChange={setConfig} />
      </div>
      <div className="flex shrink-0 justify-end border-t border-border/40 p-2">
        <button
          type="button"
          onClick={() => onSave(JSON.stringify(config))}
          className={cn(
            "flex items-center gap-1.5 rounded bg-foreground px-3 py-1.5 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
          )}
        >
          <CheckIcon className="size-3" />
          Add to schedule
        </button>
      </div>
    </div>
  )
}
