import { useMemo } from "react"
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

export const overlayKeys = {
  list: ["overlays", "list"] as const,
  byId: (id: number) => ["overlays", "by-id", id] as const,
}

// Library list = built-in defaults (negative ids) then user overlays
// from the DB. Defaults sort first and are SHADOWED by a DB row saved
// under the same negative id — editing a default persists such a row;
// deleting it restores the pristine seed. `rows` exposes the raw DB
// list so callers can detect shadowing.
export function useOverlays() {
  const query = useQuery({
    queryKey: overlayKeys.list,
    queryFn: () => Overlays.ListOverlays() as unknown as Promise<Overlay[]>,
  })
  // Memoized so downstream deps keyed on this list only fire when the
  // underlying data actually changes.
  const merged = useMemo<Overlay[] | undefined>(
    () =>
      query.data
        ? [
            ...DEFAULT_OVERLAYS.map(
              (seed) => query.data.find((row) => row.id === seed.id) ?? seed
            ),
            ...query.data.filter((row) => row.id > 0),
          ]
        : query.data,
    [query.data]
  )
  return { ...query, data: merged, rows: query.data }
}

export function useOverlay(id: number | undefined) {
  return useQuery({
    queryKey: id !== undefined ? overlayKeys.byId(id) : ["overlays", "by-id"],
    // Negative ids resolve shadow-first: a DB row at the seed's id is
    // the edited version; the frontend seed is the fallback.
    queryFn: async () => {
      if (id === undefined) return undefined
      if (isDefaultOverlayId(id)) {
        try {
          return (await Overlays.OverlayByID(id)) as unknown as Overlay
        } catch {
          const found = DEFAULT_OVERLAYS.find((o) => o.id === id)
          if (!found) throw new Error(`Unknown default overlay ${id}`)
          return found
        }
      }
      return (await Overlays.OverlayByID(id)) as unknown as Overlay
    },
    enabled: id !== undefined,
  })
}

// SaveWithID is the shadow-a-seed path: the editor routes commits on
// default overlays here so the edit persists a full row reusing the
// seed's negative id. Restore = useDeleteOverlay(negativeId).
export function useSaveOverlayWithID() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateOverlayInput & { id: number }) =>
      Overlays.SaveWithID(
        input.id,
        input.name,
        input.kind,
        input.configJSON,
        input.layoutsJSON,
        input.rulesJSON
      ) as unknown as Promise<Overlay>,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: overlayKeys.list })
      qc.invalidateQueries({ queryKey: overlayKeys.byId(vars.id) })
    },
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
  return {
    name: def.defaultName,
    kind,
    configJSON: JSON.stringify(def.defaultConfig),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: overlayKeys.list })
      // Deleting a shadow row restores the seed — the by-id cache for
      // that id must refetch or it keeps serving the deleted edit.
      qc.invalidateQueries({ queryKey: ["overlays", "by-id"] })
    },
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
