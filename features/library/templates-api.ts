import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Templates } from "@/bindings/neoprojector/services/templates"
import type { Template } from "@/bindings/neoprojector/database"
import {
  defaultTemplates,
  findDefaultTemplate,
  isDefaultTemplateId,
} from "@/features/templates/defaults"

export const templateKeys = {
  list: ["templates", "list"] as const,
  one: (id: number) => ["templates", "one", id] as const,
}

// useTemplates returns the merged list: frontend defaults first (a
// stable "reference shelf" at the top of the tile grid), then user
// rows. Defaults are SHADOWED by a DB row saved under the same
// negative id — editing a default persists such a row; deleting it
// restores the pristine seed. `rows` exposes the raw DB list so
// callers can detect shadowing.
export function useTemplates() {
  const query = useQuery({
    queryKey: templateKeys.list,
    queryFn: () =>
      Templates.ListTemplates() as unknown as Promise<Template[]>,
  })
  // Memoized so downstream useMemo/useEffect deps keyed on this list
  // only fire when the underlying data actually changes.
  const merged = useMemo<Template[] | undefined>(
    () =>
      query.data
        ? [
            ...defaultTemplates.map(
              (seed) => query.data.find((row) => row.id === seed.id) ?? seed
            ),
            ...query.data.filter((row) => row.id > 0),
          ]
        : query.data,
    [query.data]
  )
  return { ...query, data: merged, rows: query.data }
}

// useTemplate resolves a single template by id. Negative ids resolve
// against the merged list so a shadow row wins over the seed; positive
// ids hit the DB directly. Either way the consumer gets a Template-
// shaped object so editor code stays uniform.
export function useTemplate(id: number | undefined) {
  const isDefault = id !== undefined && isDefaultTemplateId(id)
  const list = useTemplates()
  const dbQuery = useQuery({
    queryKey: id ? templateKeys.one(id) : ["templates", "one", "none"],
    queryFn: () =>
      Templates.TemplateByID(id!) as unknown as Promise<Template>,
    enabled: !!id && !isDefault,
  })
  if (isDefault && id !== undefined) {
    const found =
      list.data?.find((t) => t.id === id) ?? findDefaultTemplate(id)
    return {
      data: found,
      isLoading: list.isLoading,
      isError: !found && !list.isLoading,
    }
  }
  return dbQuery
}

// useSaveTemplateWithID is the shadow-a-seed path: the editor's
// autosave routes negative ids here so editing a default persists a
// row reusing the seed's id. Restore = useDeleteTemplate(negativeId).
export function useSaveTemplateWithID() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateTemplateInput) =>
      Templates.SaveWithID(
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
    },
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => Templates.DeleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKeys.list }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKeys.list }),
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
    },
  })
}
