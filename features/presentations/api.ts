import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Presentations } from "@/bindings/neoprojector/services/presentations"
import { PlaybackSettings } from "@/bindings/neoprojector/services/presentations"
import type {
  Presentation,
  ListPresentationSlidesRow,
  PresentationSlide,
} from "@/bindings/neoprojector/database"
import { pushPresentation, removePresentation } from "@/lib/library-sync"

// Stable query keys for presentation reads. Mutations invalidate the
// specific keys they touched so unrelated views (e.g. library tab vs
// editor for a different presentation) don't refetch needlessly.
export const presentationKeys = {
  list: ["presentations", "list"] as const,
  one: (id: number) => ["presentations", "one", id] as const,
  slides: (id: number) => ["presentations", "slides", id] as const,
}

export function usePresentations() {
  return useQuery({
    queryKey: presentationKeys.list,
    queryFn: () =>
      Presentations.ListPresentations() as unknown as Promise<Presentation[]>,
  })
}

export function usePresentation(id: number | null) {
  return useQuery({
    queryKey: id !== null ? presentationKeys.one(id) : ["presentations", "one", "none"],
    queryFn: () =>
      Presentations.PresentationByID(id!) as unknown as Promise<Presentation>,
    enabled: id !== null,
  })
}

export function usePresentationSlides(id: number | null) {
  return useQuery({
    queryKey:
      id !== null ? presentationKeys.slides(id) : ["presentations", "slides", "none"],
    queryFn: () =>
      Presentations.ListSlides(id!) as unknown as Promise<
        ListPresentationSlidesRow[]
      >,
    enabled: id !== null,
  })
}

export function useCreatePresentation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      Presentations.CreatePresentation(name) as unknown as Promise<Presentation>,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: presentationKeys.list })
      qc.setQueryData(presentationKeys.one(created.id), created)
      void pushPresentation(created, 0).then(() => {
        qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
      })
    },
  })
}

export function useRenamePresentation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      Presentations.RenamePresentation(id, name) as unknown as Promise<Presentation>,
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: presentationKeys.list })
      qc.setQueryData(presentationKeys.one(updated.id), updated)
      void pushPresentation(updated).then(() => {
        qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
      })
    },
  })
}

export function useDeletePresentation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await Presentations.DeletePresentation(id)
      await removePresentation(id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: presentationKeys.list })
      qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
    },
  })
}

export function useAddSlide(presentationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (mediaId: number) =>
      Presentations.AddSlide(
        presentationId,
        mediaId
      ) as unknown as Promise<PresentationSlide>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: presentationKeys.slides(presentationId) })
    },
  })
}

export function useDeleteSlide(presentationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slideId: number) =>
      Presentations.DeleteSlide(slideId) as unknown as Promise<void>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: presentationKeys.slides(presentationId) })
    },
  })
}

export function useUpdatePlayback(presentationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (settings: {
      loop: boolean
      interval_ms: number
      transition_kind: string
      transition_duration_ms: number
    }) =>
      Presentations.UpdatePlayback(
        presentationId,
        new PlaybackSettings(settings)
      ) as unknown as Promise<Presentation>,
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: presentationKeys.list })
      qc.setQueryData(presentationKeys.one(updated.id), updated)
      void pushPresentation(updated).then(() => {
        qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
      })
    },
  })
}

export function useReorderSlides(presentationId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) =>
      Presentations.ReorderSlides(ids) as unknown as Promise<void>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: presentationKeys.slides(presentationId) })
    },
  })
}
