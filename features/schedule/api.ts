import { useCallback } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Schedule } from "@/bindings/neoprojector/services/schedule"
import { BibleRef, OverlayItemSpec } from "@/bindings/neoprojector/services/schedule"
import type {
  Service,
  ServiceSection,
  ListServiceItemsWithContentRow,
} from "@/bindings/neoprojector/database"

export const scheduleKeys = {
  services: ["schedule", "services"] as const,
  sections: (serviceId: number) =>
    ["schedule", "sections", serviceId] as const,
  items: (sectionId: number) => ["schedule", "items", sectionId] as const,
}

export { BibleRef }

export function useServices() {
  return useQuery({
    queryKey: scheduleKeys.services,
    queryFn: () => Schedule.ListServices() as unknown as Promise<Service[]>,
  })
}

export function useCreateService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      Schedule.CreateService(name) as unknown as Promise<Service>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.services }),
  })
}

export function useRenameService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      Schedule.RenameService(id, name) as unknown as Promise<Service>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.services }),
  })
}

export function useDeleteService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => Schedule.DeleteService(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.services }),
  })
}

export function useSections(serviceId: number | undefined) {
  return useQuery({
    queryKey: serviceId
      ? scheduleKeys.sections(serviceId)
      : ["schedule", "sections", "none"],
    queryFn: () =>
      Schedule.ListSections(serviceId!) as unknown as Promise<
        ServiceSection[]
      >,
    enabled: !!serviceId,
  })
}

export function useCreateSection(serviceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      Schedule.CreateSection(serviceId, name) as unknown as Promise<
        ServiceSection
      >,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.sections(serviceId) }),
  })
}

export function useRenameSection(serviceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      Schedule.RenameSection(id, name) as unknown as Promise<ServiceSection>,
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.sections(serviceId) }),
  })
}

export function useDeleteSection(serviceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => Schedule.DeleteSection(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.sections(serviceId) }),
  })
}

export function useSetSectionColor(serviceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, color }: { id: number; color: string }) =>
      Schedule.SetSectionColor(id, color) as unknown as Promise<ServiceSection>,
    // Optimistic: patch the cache so the swatch + borders flip the moment
    // the user picks a color, before the IPC round-trip returns.
    onMutate: async ({ id, color }) => {
      const key = scheduleKeys.sections(serviceId)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<ServiceSection[]>(key)
      if (previous) {
        qc.setQueryData(
          key,
          previous.map((s) => (s.id === id ? { ...s, color } : s))
        )
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(scheduleKeys.sections(serviceId), context.previous)
      }
    },
    onSettled: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.sections(serviceId) }),
  })
}

export function useReorderSections(serviceId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => Schedule.ReorderSections(ids),
    onMutate: async (ids) => {
      const key = scheduleKeys.sections(serviceId)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<ServiceSection[]>(key)
      if (previous) {
        const byId = new Map(previous.map((s) => [s.id, s]))
        qc.setQueryData(
          key,
          ids
            .map((id, idx) => {
              const row = byId.get(id)
              return row ? { ...row, position: idx } : null
            })
            .filter((s): s is ServiceSection => s !== null)
        )
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(scheduleKeys.sections(serviceId), context.previous)
      }
    },
    onSettled: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.sections(serviceId) }),
  })
}

export function useItems(sectionId: number | undefined) {
  return useQuery({
    queryKey: sectionId
      ? scheduleKeys.items(sectionId)
      : ["schedule", "items", "none"],
    queryFn: () =>
      Schedule.ListItems(sectionId!) as unknown as Promise<
        ListServiceItemsWithContentRow[]
      >,
    enabled: !!sectionId,
  })
}

export function useAddSongItem(sectionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (songId: number) => Schedule.AddSongItem(sectionId, songId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.items(sectionId) }),
  })
}

export function useAddBibleItem(sectionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ref: BibleRef) => Schedule.AddBibleItem(sectionId, ref),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.items(sectionId) }),
  })
}

export function useUpdateBibleItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, ref }: { itemId: number; ref: BibleRef }) =>
      Schedule.UpdateBibleItem(itemId, ref),
    onSettled: () => qc.invalidateQueries({ queryKey: ["schedule", "items"] }),
  })
}

export function useAddMediaItem(sectionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mediaId: number) =>
      Schedule.AddMediaItem(sectionId, mediaId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.items(sectionId) }),
  })
}

// Add an overlay schedule item. spec is the snapshot the picker
// built from a library overlay (kind, name, config + layouts).
export function useAddOverlayItem(sectionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (spec: OverlayItemSpec) =>
      Schedule.AddOverlayItem(sectionId, spec),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.items(sectionId) }),
  })
}

// Update the function-config of an overlay schedule item in place
// (countdown duration, name card text, …). Layouts stay snapshotted.
export function useUpdateOverlayItemConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, configJSON }: { itemId: number; configJSON: string }) =>
      Schedule.UpdateOverlayItemConfig(itemId, configJSON),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ["schedule", "items"] }),
  })
}

export function useDeleteItem(sectionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => Schedule.DeleteItem(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.items(sectionId) }),
  })
}

// useMoveItem moves a single item to a (possibly different) section + position.
// It invalidates both the source section and the destination section so both
// item lists refresh.
export function useMoveItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      itemId,
      targetSectionId,
      position,
    }: {
      itemId: number
      targetSectionId: number
      position: number
    }) => Schedule.MoveItem(itemId, targetSectionId, position),
    onSettled: (_data, _err, vars) => {
      // Invalidate the whole items key family so every section's list refreshes.
      qc.invalidateQueries({ queryKey: ["schedule", "items"] })
      // Touch sections too in case any UI depends on section composition.
      void vars
    },
  })
}

// Section name used by the ad-hoc bible flow. Auto-created in the
// active service when the operator broadcasts a verse from the
// library so they can re-pick it later without re-typing.
export const PREVIOUS_VERSES_SECTION = "Previous verses"

// useAppendPreviousVerse: idempotently appends an ad-hoc bible
// reference to the active service's "Previous verses" section.
// Creates the section on first use, dedupes against existing rows so
// re-broadcasting the same reference doesn't pile up duplicates.
export function useAppendPreviousVerse(serviceId: number | undefined) {
  const qc = useQueryClient()
  return useCallback(
    async (ref: BibleRef) => {
      if (!serviceId) return
      const sections = (await qc.fetchQuery({
        queryKey: scheduleKeys.sections(serviceId),
        queryFn: () =>
          Schedule.ListSections(serviceId) as unknown as Promise<
            ServiceSection[]
          >,
      })) as ServiceSection[]
      let section = sections.find(
        (s) => s.name === PREVIOUS_VERSES_SECTION
      )
      if (!section) {
        section = (await Schedule.CreateSection(
          serviceId,
          PREVIOUS_VERSES_SECTION
        )) as unknown as ServiceSection
        qc.invalidateQueries({
          queryKey: scheduleKeys.sections(serviceId),
        })
      }
      const items = (await qc.fetchQuery({
        queryKey: scheduleKeys.items(section.id),
        queryFn: () =>
          Schedule.ListItems(section!.id) as unknown as Promise<
            ListServiceItemsWithContentRow[]
          >,
      })) as ListServiceItemsWithContentRow[]
      const duplicate = items.some(
        (i) =>
          i.kind === "bible" &&
          i.book === ref.book &&
          i.chapter === ref.chapter &&
          i.verse_start === ref.verse_start &&
          i.verse_end === ref.verse_end
      )
      if (duplicate) return
      await Schedule.AddBibleItem(section.id, ref)
      qc.invalidateQueries({ queryKey: scheduleKeys.items(section.id) })
    },
    [qc, serviceId]
  )
}

export function useReorderItems(sectionId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => Schedule.ReorderItems(ids),
    onMutate: async (ids) => {
      const key = scheduleKeys.items(sectionId)
      await qc.cancelQueries({ queryKey: key })
      const previous =
        qc.getQueryData<ListServiceItemsWithContentRow[]>(key)
      if (previous) {
        const byId = new Map(previous.map((i) => [i.id, i]))
        qc.setQueryData(
          key,
          ids
            .map((id, idx) => {
              const row = byId.get(id)
              return row ? { ...row, position: idx } : null
            })
            .filter(
              (r): r is ListServiceItemsWithContentRow => r !== null
            )
        )
      }
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(scheduleKeys.items(sectionId), context.previous)
      }
    },
    onSettled: () =>
      qc.invalidateQueries({ queryKey: scheduleKeys.items(sectionId) }),
  })
}
