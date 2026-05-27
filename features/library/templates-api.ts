import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Templates } from "@/bindings/neoprojector/services/templates"
import type { Template } from "@/bindings/neoprojector/database"
import {
  defaultTemplates,
  findDefaultTemplate,
  isDefaultTemplateId,
} from "@/features/templates/defaults"
import { pushTemplate, removeTemplate } from "@/lib/library-sync"

export const templateKeys = {
  list: ["templates", "list"] as const,
  one: (id: number) => ["templates", "one", id] as const,
}

// useTemplates returns the merged list: frontend defaults first
// (always present, never editable), then user-owned rows from the DB.
// The order matters — defaults read as a stable "reference shelf" at
// the top of the tile grid.
export function useTemplates() {
  const query = useQuery({
    queryKey: templateKeys.list,
    queryFn: () =>
      Templates.ListTemplates() as unknown as Promise<Template[]>,
  })
  const merged: Template[] | undefined = query.data
    ? [...defaultTemplates, ...query.data]
    : query.data
  return { ...query, data: merged }
}

// useTemplate resolves to a single template by id. Negative ids hit
// the frontend defaults table; positive ids hit the DB. Either way
// the consumer gets back a Template-shaped object with the same
// fields so editor code stays uniform.
export function useTemplate(id: number | undefined) {
  const isDefault = id !== undefined && isDefaultTemplateId(id)
  const dbQuery = useQuery({
    queryKey: id ? templateKeys.one(id) : ["templates", "one", "none"],
    queryFn: () =>
      Templates.TemplateByID(id!) as unknown as Promise<Template>,
    enabled: !!id && !isDefault,
  })
  if (isDefault && id !== undefined) {
    const found = findDefaultTemplate(id)
    return {
      data: found,
      isLoading: false,
      isError: !found,
    }
  }
  return dbQuery
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await Templates.DeleteTemplate(id)
      await removeTemplate(id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: templateKeys.list })
      qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
    },
  })
}

export type CreateTemplateInput = {
  name: string
  kind: string
  viewportW: number
  viewportH: number
  dataJSON: string
}

// useCreateTemplate is what powers "Duplicate to edit" on a default —
// posts the default's body as a fresh user-owned row. Also used for
// the future Add-Template button.
export function useCreateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateTemplateInput) =>
      Templates.CreateTemplate(
        input.name,
        input.kind,
        input.viewportW,
        input.viewportH,
        input.dataJSON
      ) as unknown as Promise<Template>,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: templateKeys.list })
      qc.setQueryData(templateKeys.one(created.id), created)
      void pushTemplate(created).then(() => {
        qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
      })
    },
  })
}

// useDuplicateTemplate copies an existing user template. Defaults are
// not eligible (they're not in the DB) — UI should route to
// CreateTemplate with the default's body instead.
export function useDuplicateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      Templates.DuplicateTemplate(id) as unknown as Promise<Template>,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: templateKeys.list })
      void pushTemplate(created).then(() => {
        qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
      })
    },
  })
}

export type UpdateTemplateInput = {
  id: number
  name: string
  kind: string
  viewportW: number
  viewportH: number
  dataJSON: string
}

export function useUpdateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateTemplateInput) =>
      Templates.UpdateTemplate(
        input.id,
        input.name,
        input.kind,
        input.viewportW,
        input.viewportH,
        input.dataJSON
      ) as unknown as Promise<Template>,
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: templateKeys.list })
      qc.setQueryData(templateKeys.one(saved.id), saved)
      void pushTemplate(saved).then(() => {
        qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
      })
    },
  })
}
