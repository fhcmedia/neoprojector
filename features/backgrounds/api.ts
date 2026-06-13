import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Backgrounds } from "@/bindings/neoprojector/services/backgrounds"
import { Service as Schedule } from "@/bindings/neoprojector/services/schedule"
import type { Background } from "@/bindings/neoprojector/database"
import { scheduleKeys } from "@/features/schedule/api"
import { defaultBackgrounds, type BackgroundDoc } from "./presets"

export const backgroundKeys = {
  list: ["backgrounds", "list"] as const,
  service: (serviceId: number) =>
    ["backgrounds", "service", serviceId] as const,
}

// Merged list: seeds shadowed by any DB row saved under the same
// (negative) id, then user rows. Identity is the id — schedule
// assignments keep pointing at the same id whether the seed is
// shadowed or not.
export function useBackgrounds() {
  const query = useQuery({
    queryKey: backgroundKeys.list,
    queryFn: () =>
      Backgrounds.ListBackgrounds() as unknown as Promise<Background[]>,
  })
  // Memoized on the query data: effects key off this list's identity
  // (the service-background bridge, show-pane overrides), so a fresh
  // array per render would re-fire them every render — which is how
  // the PushLive-per-frame log storm happened.
  const merged = useMemo<BackgroundDoc[] | undefined>(
    () =>
      query.data
        ? [
            ...defaultBackgrounds.map(
              (seed) => query.data.find((row) => row.id === seed.id) ?? seed
            ),
            ...query.data.filter((row) => row.id > 0),
          ]
        : undefined,
    [query.data]
  )
  // rows = raw DB rows (no seeds). Shadow detection reads this: a row
  // sitting at a seed's negative id means the seed has been edited.
  return { ...query, data: merged, rows: query.data }
}

export function useCreateBackground() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; engine: string; configJSON: string }) =>
      Backgrounds.CreateBackground(
        input.name,
        input.engine,
        input.configJSON
      ) as unknown as Promise<Background>,
    onSuccess: () => qc.invalidateQueries({ queryKey: backgroundKeys.list }),
  })
}

export function useUpdateBackground() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: number
      name: string
      engine: string
      configJSON: string
    }) =>
      Backgrounds.UpdateBackground(
        input.id,
        input.name,
        input.engine,
        input.configJSON
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: backgroundKeys.list }),
  })
}

// SaveWithID is the shadow-a-seed path: editing a default persists a
// row reusing the seed's negative id, so every schedule assignment
// keeps pointing at the same id.
export function useSaveBackgroundWithID() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: number
      name: string
      engine: string
      configJSON: string
    }) =>
      Backgrounds.SaveWithID(
        input.id,
        input.name,
        input.engine,
        input.configJSON
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: backgroundKeys.list }),
  })
}

// Deleting a shadow row restores the seed; deleting a user row removes
// it (schedule assignments pointing at it resolve to inherit).
export function useDeleteBackground() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => Backgrounds.DeleteBackground(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: backgroundKeys.list }),
  })
}

// The active service's row — read for its background_id so the live
// provider can hold the service-default background. Separate key from
// the schedule lists so background changes don't refetch sections.
export function useServiceRow(serviceId: number | undefined) {
  return useQuery({
    queryKey: backgroundKeys.service(serviceId ?? 0),
    queryFn: () => Schedule.ServiceByID(serviceId!),
    enabled: !!serviceId,
  })
}

export function useSetServiceBackground() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { serviceId: number; backgroundId: number }) =>
      Schedule.SetServiceBackground(input.serviceId, input.backgroundId),
    onSuccess: (_, input) => {
      qc.invalidateQueries({
        queryKey: backgroundKeys.service(input.serviceId),
      })
      qc.invalidateQueries({ queryKey: scheduleKeys.services })
    },
  })
}

export function useSetSectionBackground(serviceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { sectionId: number; backgroundId: number }) =>
      Schedule.SetSectionBackground(input.sectionId, input.backgroundId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scheduleKeys.sections(serviceId) })
      // Items carry section_background_id — refresh every section's
      // item list so stamped overrides resolve against fresh data.
      qc.invalidateQueries({ queryKey: ["schedule", "items"] })
    },
  })
}

export function useSetItemBackground() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { itemId: number; backgroundId: number }) =>
      Schedule.SetItemBackground(input.itemId, input.backgroundId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["schedule", "items"] }),
  })
}
