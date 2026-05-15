import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Templates } from "@/bindings/neoprojector/services/templates"
import type { Template } from "@/bindings/neoprojector/database"

export const templateKeys = {
  list: ["templates", "list"] as const,
  one: (id: number) => ["templates", "one", id] as const,
}

export function useTemplates() {
  return useQuery({
    queryKey: templateKeys.list,
    queryFn: () =>
      Templates.ListTemplates() as unknown as Promise<Template[]>,
  })
}

export function useDuplicateTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      Templates.DuplicateTemplate(id) as unknown as Promise<Template>,
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKeys.list }),
  })
}

export function useDeleteTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => Templates.DeleteTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: templateKeys.list }),
  })
}
