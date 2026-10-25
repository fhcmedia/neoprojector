import { useMemo, useState } from "react"
import { CheckIcon } from "lucide-react"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import { Button } from "@/components/button"
import { widgetDef } from "@/features/overlays/widgets"
import {
  parseConfig,
  parseLayouts,
  parseRules,
  type OverlayRules,
  type WidgetKind,
} from "@/features/overlays/types"
import { BehaviorRules } from "@/features/overlays/editor/behavior-rules"
import {
  useUpdateOverlayItemConfig,
  useUpdateOverlayItemRules,
} from "@/features/schedule/api"

// OverlayItemEditor: edits a scheduled overlay's per-instance config
// and behavior rules in place. Layouts stay snapshotted from add time —
// operators tweak the visual style by going to the library and creating
// a new variant. The flow mirrors the picker's ConfigureStep but writes
// back instead of creating. Changes apply the next time the overlay is
// turned on (an already-active overlay keeps its activation snapshot).
export function OverlayItemEditor({
  item,
  onDone,
}: {
  item: ListServiceItemsWithContentRow
  onDone: () => void
}) {
  const configMut = useUpdateOverlayItemConfig()
  const rulesMut = useUpdateOverlayItemRules()
  const def = widgetDef(item.overlay_kind as WidgetKind)

  const layouts = useMemo(
    () => parseLayouts(item.overlay_layouts_json, def.defaultLayout),
    [item.overlay_layouts_json, def.defaultLayout]
  )
  const [config, setConfig] = useState(() =>
    parseConfig(item.overlay_config_json, def.defaultConfig)
  )
  const [rules, setRules] = useState<OverlayRules>(() =>
    parseRules(item.overlay_rules_json, def.defaultRules)
  )
  const saving = configMut.isPending || rulesMut.isPending

  async function handleSave() {
    await Promise.all([
      configMut.mutateAsync({ itemId: item.id, configJSON: JSON.stringify(config) }),
      rulesMut.mutateAsync({ itemId: item.id, rulesJSON: JSON.stringify(rules) }),
    ])
    onDone()
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
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
        <def.ConfigEditor config={config} onChange={setConfig} />
        <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Behavior
          </div>
          <BehaviorRules rules={rules} onChange={setRules} />
        </div>
      </div>
      <div className="flex shrink-0 justify-end border-t border-border/40 p-2">
        <Button size="xs" onClick={() => void handleSave()} disabled={saving}>
          <CheckIcon />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}
