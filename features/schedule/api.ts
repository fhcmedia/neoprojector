import { useCallback } from "react"
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
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

// Auto-inbox section names. Created lazily in the active service when
// the operator first sends something live from the library so they
// can re-pick the same item later without re-finding it. Both auto-
// sections sit at the end of the schedule; "Media from Library"
// appears above "Scripture from Library" so the two have a stable
// relative position regardless of which one was created first.
export const MEDIA_FROM_LIBRARY_SECTION = "Media from Library"
export const SCRIPTURE_FROM_LIBRARY_SECTION = "Scripture from Library"
// Legacy: very early builds shipped "Previous verses" instead. We
// keep accepting that name on lookup so an existing service's items
// don't get orphaned next to a brand-new "Scripture from Library"
// section. New sections are always created under the new name.
const LEGACY_SCRIPTURE_SECTION = "Previous verses"

// Auto sections only appended at end never bumped to top. Order:
// [user sections] [media] [scripture]
const AUTO_SECTION_ORDER = [
  MEDIA_FROM_LIBRARY_SECTION,
  SCRIPTURE_FROM_LIBRARY_SECTION,
  LEGACY_SCRIPTURE_SECTION,
]

function isAutoSectionName(name: string): boolean {
  return AUTO_SECTION_ORDER.includes(name)
}

// ensureAutoSectionOrder rearranges sections so any auto-inbox
// sections sit at the very bottom in the canonical order above.
// User-defined sections retain their current relative order. Safe
// to call after any auto-section create — idempotent, no-op when
// the order is already correct.
async function ensureAutoSectionOrder(
  qc: QueryClient,
  serviceId: number
): Promise<ServiceSection[]> {
  const sections = (await qc.fetchQuery({
    queryKey: scheduleKeys.sections(serviceId),
    queryFn: () =>
      Schedule.ListSections(serviceId) as unknown as Promise<ServiceSection[]>,
  })) as ServiceSection[]
  const userSections = sections.filter((s) => !isAutoSectionName(s.name))
  const autoByName = new Map<string, ServiceSection>()
  for (const s of sections) {
    if (isAutoSectionName(s.name)) autoByName.set(s.name, s)
  }
  const orderedAuto: ServiceSection[] = []
  for (const name of AUTO_SECTION_ORDER) {
    const s = autoByName.get(name)
    if (s) orderedAuto.push(s)
  }
  const desired = [...userSections, ...orderedAuto]
  const desiredIds = desired.map((s) => s.id)
  const currentIds = sections.map((s) => s.id)
  const same =
    desiredIds.length === currentIds.length &&
    desiredIds.every((id, i) => id === currentIds[i])
  if (same) return sections
  await Schedule.ReorderSections(desiredIds)
  qc.invalidateQueries({ queryKey: scheduleKeys.sections(serviceId) })
  return desired
}

// findOrCreateAutoSection looks up an auto-inbox section by name,
// creating it on first use, and re-asserts the canonical bottom
// ordering so it lands in the right place relative to siblings.
async function findOrCreateAutoSection(
  qc: QueryClient,
  serviceId: number,
  name: string,
  alsoAcceptNames: string[] = []
): Promise<ServiceSection> {
  const sections = (await qc.fetchQuery({
    queryKey: scheduleKeys.sections(serviceId),
    queryFn: () =>
      Schedule.ListSections(serviceId) as unknown as Promise<ServiceSection[]>,
  })) as ServiceSection[]
  const accepted = new Set([name, ...alsoAcceptNames])
  let section = sections.find((s) => accepted.has(s.name))
  if (!section) {
    section = (await Schedule.CreateSection(
      serviceId,
      name
    )) as unknown as ServiceSection
    qc.invalidateQueries({ queryKey: scheduleKeys.sections(serviceId) })
  }
  await ensureAutoSectionOrder(qc, serviceId)
  return section
}

// useAppendPreviousVerse: appends an ad-hoc bible reference to the
// active service's "Scripture from Library" inbox. Adjacent /
// overlapping verses MERGE into the last item rather than creating
// a fresh one — so Mark 1:5 → Mark 1:6 → Mark 1:7 stays as a single
// Mark 1:5-7 row instead of three. Non-adjacent refs (different
// book, different chapter, or a gap > 1) start a new item.
//
// Merge rule on the last item L and new ref R when same book +
// chapter and ranges touch or overlap (R.start <= L.end+1 AND
// R.end+1 >= L.start): replace L with [min(starts), max(ends)].
// Already-contained refs collapse to a no-op.
export function useAppendPreviousVerse(serviceId: number | undefined) {
  const qc = useQueryClient()
  return useCallback(
    async (ref: BibleRef): Promise<number | null> => {
      if (!serviceId) return null
      const section = await findOrCreateAutoSection(
        qc,
        serviceId,
        SCRIPTURE_FROM_LIBRARY_SECTION,
        [LEGACY_SCRIPTURE_SECTION]
      )
      const items = (await qc.fetchQuery({
        queryKey: scheduleKeys.items(section.id),
        queryFn: () =>
          Schedule.ListItems(section.id) as unknown as Promise<
            ListServiceItemsWithContentRow[]
          >,
      })) as ListServiceItemsWithContentRow[]

      const last = items[items.length - 1]
      if (
        last &&
        last.kind === "bible" &&
        last.book === ref.book &&
        last.chapter === ref.chapter
      ) {
        // Adjacent / overlapping → merge into last item.
        const touches =
          ref.verse_start <= last.verse_end + 1 &&
          ref.verse_end + 1 >= last.verse_start
        if (touches) {
          const merged = {
            book: ref.book,
            chapter: ref.chapter,
            verse_start: Math.min(last.verse_start, ref.verse_start),
            verse_end: Math.max(last.verse_end, ref.verse_end),
          }
          if (
            merged.verse_start === last.verse_start &&
            merged.verse_end === last.verse_end
          ) {
            // Already covered — no DB write needed, but it's still the
            // row that's now live.
            return last.id
          }
          await Schedule.UpdateBibleItem(last.id, merged)
          qc.invalidateQueries({ queryKey: scheduleKeys.items(section.id) })
          return last.id
        }
      }
      // No mergeable neighbor — append a new item.
      const created = (await Schedule.AddBibleItem(section.id, ref)) as
        | { id?: number }
        | undefined
      qc.invalidateQueries({ queryKey: scheduleKeys.items(section.id) })
      return created?.id ?? null
    },
    [qc, serviceId]
  )
}

// useAppendMediaFromLibrary: appends a media id to the active service's
// "Media from Library" inbox. Same auto-section + ordering machinery
// as the scripture inbox. No merge / dedupe behaviour — sending the
// same media twice intentionally creates two rows so the operator can
// build a sequence (e.g. announcement loop) from repeated clicks.
export function useAppendMediaFromLibrary(serviceId: number | undefined) {
  const qc = useQueryClient()
  return useCallback(
    async (mediaId: number): Promise<number | null> => {
      if (!serviceId) return null
      const section = await findOrCreateAutoSection(
        qc,
        serviceId,
        MEDIA_FROM_LIBRARY_SECTION
      )
      const item = (await Schedule.AddMediaItem(
        section.id,
        mediaId
      )) as unknown as { id: number }
      qc.invalidateQueries({ queryKey: scheduleKeys.items(section.id) })
      return item.id
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
