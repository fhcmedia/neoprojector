import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Schedule } from "@/bindings/neoprojector/services/schedule"
import { BibleRef } from "@/bindings/neoprojector/services/schedule"
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
