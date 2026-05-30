import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Overlays } from "@/bindings/neoprojector/services/overlays"
import type { Overlay } from "@/bindings/neoprojector/database"
import {
  DEFAULT_OVERLAYS,
  isDefaultOverlayId,
} from "@/features/overlays/defaults"
import { widgetDef } from "@/features/overlays/widgets"
import type {
  OverlayLayouts,
  WidgetKind,
} from "@/features/overlays/types"
import { loadTranscriptionSettings } from "@/features/transcription/settings"
import { transcriptionDefaultConfig } from "@/features/transcription/config"

export const overlayKeys = {
  list: ["overlays", "list"] as const,
  byId: (id: number) => ["overlays", "by-id", id] as const,
}

// Library list = built-in defaults (negative ids) then user overlays
// from the DB. Defaults sort first; user list keeps the position
// order the server returns.
export function useOverlays() {
  return useQuery({
    queryKey: overlayKeys.list,
    queryFn: async () => {
      const dbRows = (await Overlays.ListOverlays()) as unknown as Overlay[]
      return [...DEFAULT_OVERLAYS, ...dbRows]
    },
  })
}

export function useOverlay(id: number | undefined) {
  return useQuery({
    queryKey: id !== undefined ? overlayKeys.byId(id) : ["overlays", "by-id"],
    // Default overlays live in the frontend — short-circuit the IPC.
    // The DEFAULT_OVERLAYS array is the authoritative source.
    queryFn: async () => {
      if (id === undefined) return undefined
      if (isDefaultOverlayId(id)) {
        const found = DEFAULT_OVERLAYS.find((o) => o.id === id)
        if (!found) throw new Error(`Unknown default overlay ${id}`)
        return found
      }
      return (await Overlays.OverlayByID(id)) as unknown as Overlay
    },
    enabled: id !== undefined,
  })
}

// CreateOverlay takes the full spec because each widget kind ships
// its own defaults. The library "+" button always seeds from the
// registry; "duplicate" copies an existing row's body.
export type CreateOverlayInput = {
  name: string
  kind: WidgetKind
  configJSON: string
  layoutsJSON: string
  rulesJSON: string
}

export function useCreateOverlay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateOverlayInput) =>
      Overlays.CreateOverlay(
        input.name,
        input.kind,
        input.configJSON,
        input.layoutsJSON,
        input.rulesJSON
      ) as unknown as Promise<Overlay>,
    onSuccess: () => qc.invalidateQueries({ queryKey: overlayKeys.list }),
  })
}

// Convenience: seed a brand-new overlay from a WidgetKind using the
// registry's defaults. Used by the "+" entry in the library tab.
export function buildCreateInputForKind(kind: WidgetKind): CreateOverlayInput {
  const def = widgetDef(kind)
  const layouts: OverlayLayouts = {
    default: def.defaultLayout,
    displays: {},
  }
  // Caption overlays seed their per-overlay config from the global
  // transcription defaults (Settings → Transcription) so a freshly
  // added overlay matches the operator's preferred model/language.
  let config: Record<string, unknown> = def.defaultConfig
  if (kind === "transcription") {
    const s = loadTranscriptionSettings()
    config = {
      ...transcriptionDefaultConfig,
      model: s.model,
      language: s.language,
      latency: s.latency,
      prompt: s.prompt,
    }
  }
  return {
    name: def.defaultName,
    kind,
    configJSON: JSON.stringify(config),
    layoutsJSON: JSON.stringify(layouts),
    rulesJSON: JSON.stringify(def.defaultRules),
  }
}

// Duplicate a row (default or DB-backed) into a new user overlay.
export function buildCreateInputFromOverlay(o: Overlay): CreateOverlayInput {
  return {
    name: `${o.name} copy`,
    kind: o.kind as WidgetKind,
    configJSON: o.config_json,
    layoutsJSON: o.layouts_json,
    rulesJSON: o.rules_json,
  }
}

export function useRenameOverlay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      Overlays.RenameOverlay(id, name) as unknown as Promise<Overlay>,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: overlayKeys.list })
      qc.invalidateQueries({ queryKey: overlayKeys.byId(vars.id) })
    },
  })
}

export function useDeleteOverlay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => Overlays.DeleteOverlay(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: overlayKeys.list }),
  })
}

export function useSetOverlayConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, configJSON }: { id: number; configJSON: string }) =>
      Overlays.SetConfig(id, configJSON) as unknown as Promise<Overlay>,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: overlayKeys.list })
      qc.invalidateQueries({ queryKey: overlayKeys.byId(vars.id) })
    },
  })
}

export function useSetOverlayLayouts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, layoutsJSON }: { id: number; layoutsJSON: string }) =>
      Overlays.SetLayouts(id, layoutsJSON) as unknown as Promise<Overlay>,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: overlayKeys.list })
      qc.invalidateQueries({ queryKey: overlayKeys.byId(vars.id) })
    },
  })
}

export function useSetOverlayRules() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, rulesJSON }: { id: number; rulesJSON: string }) =>
      Overlays.SetRules(id, rulesJSON) as unknown as Promise<Overlay>,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: overlayKeys.list })
      qc.invalidateQueries({ queryKey: overlayKeys.byId(vars.id) })
    },
  })
}
