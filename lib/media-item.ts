import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { Medium } from "@/bindings/neoprojector/database"

// useMediaItem looks a media row up in the window's cached media list —
// how renderers learn whether an id is an image, video or audio.
//
// Each window (operator, every projector) has its own cache. Media
// imported after a window loaded its list — a deck imported mid-service,
// a photo dropped into a presentation — isn't in it, and a renderer that
// can't tell the type draws black. So an id missing from a loaded list
// refetches it (React Query dedupes concurrent refetches; the throttle
// stops a truly unknown id from hammering the backend).
const MISSING_REFETCH_MS = 1000
let lastMissingRefetch = 0

export function useMediaItem(mediaId: number | null | undefined): {
  item: Medium | undefined
  loaded: boolean
} {
  const q = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
    staleTime: 60_000,
  })
  const item = mediaId ? q.data?.find((m) => m.id === mediaId) : undefined
  const missing = !!mediaId && !!q.data && !item
  const { refetch, isFetching } = q
  useEffect(() => {
    if (!missing || isFetching) return
    const wait = Math.max(0, lastMissingRefetch + MISSING_REFETCH_MS - Date.now())
    const t = window.setTimeout(() => {
      lastMissingRefetch = Date.now()
      void refetch()
    }, wait)
    return () => window.clearTimeout(t)
  }, [missing, isFetching, refetch, mediaId])
  return { item, loaded: !!q.data }
}
