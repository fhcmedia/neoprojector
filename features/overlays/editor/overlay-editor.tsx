import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import {
  useOverlay,
  useOverlays,
  useSetOverlayConfig,
  useSetOverlayLayouts,
  useSetOverlayRules,
  useRenameOverlay,
  useSaveOverlayWithID,
} from "@/features/overlays/api"
import { isDefaultOverlayId } from "@/features/overlays/defaults"
import { widgetDef } from "@/features/overlays/widgets"
import {
  DEFAULT_RULES,
  parseConfig,
  parseLayouts,
  parseRules,
  type OverlayLayouts,
  type OverlayRules,
  type WidgetKind,
} from "@/features/overlays/types"
import type { Overlay } from "@/bindings/neoprojector/database"

// The overlay editor is a Show-page surface split across two panes —
// options where the schedule sits, preview canvas where the show pane
// sits — sharing state through this provider (single-Outlet router, so
// the regions can't be route children). Esc closes outright; overlays
// have no canvas selection to deselect first.
//
// Seed defaults (negative ids) are directly editable: the first commit
// persists a full shadow row reusing the seed's id (SaveWithID);
// restore (settings / library tile) deletes the row.
type OverlayEditorCtx = {
  overlay: Overlay | undefined
  def: ReturnType<typeof widgetDef> | null
  isSeed: boolean
  isShadowed: boolean
  name: string
  setName: (v: string) => void
  commitName: (v: string) => void
  config: Record<string, unknown>
  commitConfig: (next: Record<string, unknown>) => void
  layouts: OverlayLayouts
  commitLayouts: (next: OverlayLayouts) => void
  rules: OverlayRules
  commitRules: (next: OverlayRules) => void
  // Which layout the canvas edits: "default", or a display id (as a
  // string, matching OverlayLayouts.displays keys).
  layoutTarget: string
  setLayoutTarget: (t: string) => void
  onClose: () => void
}

const Ctx = createContext<OverlayEditorCtx | null>(null)

export function useOverlayEditor(): OverlayEditorCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useOverlayEditor outside provider")
  return ctx
}

export function OverlayEditorProvider({
  id,
  onClose,
  children,
}: {
  id: number
  onClose: () => void
  children: ReactNode
}) {
  const { data: overlay } = useOverlay(id)
  const { rows } = useOverlays()
  const renameMut = useRenameOverlay()
  const configMut = useSetOverlayConfig()
  const layoutsMut = useSetOverlayLayouts()
  const rulesMut = useSetOverlayRules()
  const saveWithIDMut = useSaveOverlayWithID()

  const isSeed = isDefaultOverlayId(id)
  const isShadowed = isSeed && !!rows?.some((r) => r.id === id)

  // Local state seeded from the row. We persist on field commit so
  // the user sees their edit echo back immediately without a save
  // button — same live-save discipline as the song editor.
  const def = overlay ? widgetDef(overlay.kind as WidgetKind) : null
  const [name, setName] = useState("")
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [layouts, setLayouts] = useState<OverlayLayouts>({
    default: { x: 0.5, y: 0.5, w: 0.3, h: 0.15, style: {} },
    displays: {},
  })
  const [rules, setRules] = useState<OverlayRules>(DEFAULT_RULES)
  const [layoutTarget, setLayoutTarget] = useState("default")

  useEffect(() => {
    if (!overlay || !def) return
    setName(overlay.name)
    setConfig(parseConfig(overlay.config_json, def.defaultConfig))
    setLayouts(parseLayouts(overlay.layouts_json, def.defaultLayout))
    setRules(parseRules(overlay.rules_json, def.defaultRules))
  }, [overlay, def])

  // Seed commits write the FULL current snapshot via the upsert — the
  // granular per-field mutations require an existing row, which a
  // pristine seed doesn't have yet. The snapshot merges the incoming
  // patch with current local state so a config edit doesn't clobber
  // in-progress layout edits.
  function saveSeedSnapshot(patch: {
    name?: string
    config?: Record<string, unknown>
    layouts?: OverlayLayouts
    rules?: OverlayRules
  }) {
    if (!overlay) return
    saveWithIDMut.mutate({
      id,
      name: (patch.name ?? name).trim() || overlay.name,
      kind: overlay.kind as WidgetKind,
      configJSON: JSON.stringify(patch.config ?? config),
      layoutsJSON: JSON.stringify(patch.layouts ?? layouts),
      rulesJSON: JSON.stringify(patch.rules ?? rules),
    })
  }

  function commitName(next: string) {
    const v = next.trim()
    if (!overlay || !v || v === overlay.name) return
    if (isSeed) saveSeedSnapshot({ name: v })
    else renameMut.mutate({ id: overlay.id, name: v })
  }

  function commitConfig(next: Record<string, unknown>) {
    setConfig(next)
    if (!overlay) return
    if (isSeed) saveSeedSnapshot({ config: next })
    else configMut.mutate({ id: overlay.id, configJSON: JSON.stringify(next) })
  }

  function commitLayouts(next: OverlayLayouts) {
    setLayouts(next)
    if (!overlay) return
    if (isSeed) saveSeedSnapshot({ layouts: next })
    else layoutsMut.mutate({ id: overlay.id, layoutsJSON: JSON.stringify(next) })
  }

  function commitRules(next: OverlayRules) {
    setRules(next)
    if (!overlay) return
    if (isSeed) saveSeedSnapshot({ rules: next })
    else rulesMut.mutate({ id: overlay.id, rulesJSON: JSON.stringify(next) })
  }

  return (
    <Ctx.Provider
      value={{
        overlay,
        def,
        isSeed,
        isShadowed,
        name,
        setName,
        commitName,
        config,
        commitConfig,
        layouts,
        commitLayouts,
        rules,
        commitRules,
        layoutTarget,
        setLayoutTarget,
        onClose,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
