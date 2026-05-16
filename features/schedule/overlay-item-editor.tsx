import { useMemo, useState } from "react"
import { CheckIcon } from "lucide-react"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import { widgetDef } from "@/features/overlays/widgets"
import {
  parseConfig,
  parseLayouts,
  type WidgetKind,
} from "@/features/overlays/types"
import { useUpdateOverlayItemConfig } from "@/features/schedule/api"

// OverlayItemEditor: edits a scheduled overlay's per-instance config
// in place. Layouts stay snapshotted from add time — operators tweak
// the visual style by going to the library and creating a new variant.
// The flow mirrors the picker's ConfigureStep but writes back instead
// of creating.
export function OverlayItemEditor({
  item,
  onDone,
}: {
  item: ListServiceItemsWithContentRow
  onDone: () => void
}) {
  const updateMut = useUpdateOverlayItemConfig()
  const def = widgetDef(item.overlay_kind as WidgetKind)

  const layouts = useMemo(
    () => parseLayouts(item.overlay_layouts_json, def.defaultLayout),
    [item.overlay_layouts_json, def.defaultLayout]
  )
  const [config, setConfig] = useState(() =>
    parseConfig(item.overlay_config_json, def.defaultConfig)
  )

  function handleSave() {
    updateMut.mutate(
      { itemId: item.id, configJSON: JSON.stringify(config) },
      { onSuccess: () => onDone() }
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2 py-2">
        <span className="text-xs font-medium">{item.label}</span>
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
          onClick={handleSave}
          className="flex items-center gap-1.5 rounded bg-foreground px-3 py-1.5 text-[11px] font-medium text-background transition-opacity hover:opacity-90"
        >
          <CheckIcon className="size-3" />
          Save
        </button>
      </div>
    </div>
  )
}
