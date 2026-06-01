import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Displays } from "@/bindings/neoprojector/services/displays"
import type { ScreenInfo } from "@/bindings/neoprojector/services/displays"
import type { Display } from "@/bindings/neoprojector/database"

export const displayKeys = {
  list: ["displays", "list"] as const,
  screens: ["displays", "screens"] as const,
}

// Polls every few seconds so plug/unplug of an external monitor
// surfaces in the Settings dropdown without the user reloading. The
// Wails screen-changed event would be nicer; this is fine for now.
export function useScreens() {
  return useQuery({
    queryKey: displayKeys.screens,
    queryFn: () => Displays.ListScreens() as unknown as Promise<ScreenInfo[]>,
    refetchInterval: 3000,
  })
}

export function useSetDisplayScreen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, screenID }: { id: number; screenID: string }) =>
      Displays.SetDisplayScreen(id, screenID) as unknown as Promise<Display>,
    onSuccess: () => qc.invalidateQueries({ queryKey: displayKeys.list }),
  })
}

// Live output lifecycle. IsLive is server-truth — poll it so the UI
// recovers when an output window is closed externally (OS shortcut,
// monitor unplug). The Go-side StartLive returns an error if no
// display is bound to a connected monitor; surface it to the caller.
export const liveKeys = {
  state: ["displays", "live", "state"] as const,
}

export function useLiveOutput() {
  return useQuery({
    queryKey: liveKeys.state,
    queryFn: () => Displays.IsLive() as unknown as Promise<boolean>,
    refetchInterval: 3000,
  })
}

export function useStartLive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => Displays.StartLive(),
    onSuccess: () => qc.invalidateQueries({ queryKey: liveKeys.state }),
  })
}

export const bypassKeys = {
  state: ["displays", "bypass"] as const,
}

export function useBypassDisplayCheck() {
  return useQuery({
    queryKey: bypassKeys.state,
    queryFn: () => Displays.GetBypassDisplayCheck() as unknown as Promise<boolean>,
  })
}

export function useSetBypassDisplayCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (bypass: boolean) =>
      Displays.SetBypassDisplayCheck(bypass) as unknown as Promise<void>,
    onSuccess: () => qc.invalidateQueries({ queryKey: bypassKeys.state }),
  })
}

export function useStopLive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => Displays.StopLive(),
    onSuccess: () => qc.invalidateQueries({ queryKey: liveKeys.state }),
  })
}

export function useDisplays() {
  return useQuery({
    queryKey: displayKeys.list,
    queryFn: () => Displays.ListDisplays() as unknown as Promise<Display[]>,
  })
}

export function useCreateDisplay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      Displays.CreateDisplay(name) as unknown as Promise<Display>,
    onSuccess: () => qc.invalidateQueries({ queryKey: displayKeys.list }),
  })
}

export function useRenameDisplay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      Displays.RenameDisplay(id, name) as unknown as Promise<Display>,
    onSuccess: () => qc.invalidateQueries({ queryKey: displayKeys.list }),
  })
}

export function useDeleteDisplay() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => Displays.DeleteDisplay(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: displayKeys.list }),
  })
}

export function useSetDisplayEnabled() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      Displays.SetDisplayEnabled(id, enabled) as unknown as Promise<Display>,
    // Optimistic toggle so the switch flips immediately, no IPC stutter.
    onMutate: async ({ id, enabled }) => {
      await qc.cancelQueries({ queryKey: displayKeys.list })
      const previous = qc.getQueryData<Display[]>(displayKeys.list)
      if (previous) {
        qc.setQueryData<Display[]>(
          displayKeys.list,
          previous.map((d) => (d.id === id ? { ...d, enabled: enabled ? 1 : 0 } : d))
        )
      }
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(displayKeys.list, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: displayKeys.list }),
  })
}

// DisplayLayer names the content kinds a display can be routed to show
// or hide independently. Mirrors the show_* columns on the Display row
// and the layer switch in the Go SetDisplayLayer service method.
export type DisplayLayer = "song" | "bible" | "media" | "overlay"

const layerField: Record<DisplayLayer, keyof Display> = {
  song: "show_song",
  bible: "show_bible",
  media: "show_media",
  overlay: "show_overlay",
}

// Per-display content routing toggle. Optimistic like the enabled
// switch so the preview's layer button flips with no IPC stutter; the
// open output windows pick up the change off the displays:changed
// emit (their own row refetch), not this cache.
export function useSetDisplayLayer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, layer, on }: { id: number; layer: DisplayLayer; on: boolean }) =>
      Displays.SetDisplayLayer(id, layer, on) as unknown as Promise<Display>,
    onMutate: async ({ id, layer, on }) => {
      await qc.cancelQueries({ queryKey: displayKeys.list })
      const previous = qc.getQueryData<Display[]>(displayKeys.list)
      if (previous) {
        const field = layerField[layer]
        qc.setQueryData<Display[]>(
          displayKeys.list,
          previous.map((d) =>
            d.id === id ? { ...d, [field]: on ? 1 : 0 } : d
          )
        )
      }
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(displayKeys.list, ctx.previous)
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: displayKeys.list })
      qc.invalidateQueries({ queryKey: ["displays", "by-id", vars.id] })
    },
  })
}

// templateID === 0 clears the binding. Negative IDs are frontend
// default templates and are stored verbatim.
export function useSetDisplayBibleTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, templateID }: { id: number; templateID: number }) =>
      Displays.SetBibleTemplate(id, templateID) as unknown as Promise<Display>,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: displayKeys.list })
      qc.invalidateQueries({ queryKey: ["displays", "by-id", vars.id] })
    },
  })
}

export function useSetDisplaySongTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, templateID }: { id: number; templateID: number }) =>
      Displays.SetSongTemplate(id, templateID) as unknown as Promise<Display>,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: displayKeys.list })
      qc.invalidateQueries({ queryKey: ["displays", "by-id", vars.id] })
    },
  })
}

export function useReorderDisplays() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => Displays.ReorderDisplays(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: displayKeys.list })
      const previous = qc.getQueryData<Display[]>(displayKeys.list)
      if (previous) {
        const byId = new Map(previous.map((d) => [d.id, d]))
        qc.setQueryData<Display[]>(
          displayKeys.list,
          ids
            .map((id, idx) => {
              const row = byId.get(id)
              return row ? { ...row, position: idx } : null
            })
            .filter((d): d is Display => d !== null)
        )
      }
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(displayKeys.list, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: displayKeys.list }),
  })
}
