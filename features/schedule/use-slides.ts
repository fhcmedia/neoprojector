import { useMemo, useEffect, useState } from "react"
import { useQueryClient, useQuery, useIsFetching } from "@tanstack/react-query"
import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import type { SlideState, SlidePreview } from "./slide-types"
import { DEFAULT_STATE } from "./slide-types"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"

import { libraryKeys } from "@/features/library/api"

export function useSlides(itemId?: number, fallbackSongId?: number) {
  const qc = useQueryClient()
  const [slideState, setSlideState] = useState<SlideState>(DEFAULT_STATE)

  const isFetchingItems = useIsFetching({ queryKey: ["schedule", "items"] })

  const item = useMemo(() => {
    if (!itemId) return null
    const lists = qc.getQueriesData<ListServiceItemsWithContentRow[]>({ queryKey: ["schedule", "items"] })
    for (const [key, list] of lists) {
      if (list) {
        const found = list.find((i) => i.id === itemId)
        if (found) return found
      }
    }
    return null
  }, [qc, itemId, isFetchingItems])

  useEffect(() => {
    if (item?.template_override_json?.Valid && item.template_override_json.String) {
      try {
        const loaded = JSON.parse(item.template_override_json.String)
        setSlideState({
          ...DEFAULT_STATE,
          ...loaded,
          overrides: loaded.overrides || {},
          animation: loaded.animation || DEFAULT_STATE.animation
        })
      } catch (e) {
        console.error("Failed to parse template override", e)
      }
    } else {
      setSlideState(DEFAULT_STATE)
    }
  }, [item])

  const targetSongId = item?.kind === "song" ? item.song_id : fallbackSongId

  const { data: songData } = useQuery({
    queryKey: libraryKeys.song(targetSongId ?? 0),
    queryFn: () => Songs.GetSong(targetSongId!),
    enabled: !!targetSongId,
  })

  const { data: bibleData } = useQuery({
    queryKey: ["bible", item?.book, item?.chapter],
    queryFn: () => Bible.ListVerses(item!.book, item!.chapter),
    enabled: !!(item?.kind === "bible" && item?.book && item?.chapter),
  })

  const slides = useMemo<SlidePreview[]>(() => {
    if (item?.kind === "song" && songData) {
      const flat: SlidePreview[] = []
      let idx = 0
      for (const section of songData.sections) {
        const content = section.lines.map(l => l.text).join("\n")
        const typeStr = section.section?.type || "Verse"
        flat.push({ id: `song-${idx++}`, title: typeStr.toUpperCase(), content, sectionId: section.section?.id })
      }
      return flat
    }
    if (!item && fallbackSongId && songData) {
      // Library Preview (no schedule item)
      const flat: SlidePreview[] = []
      let idx = 0
      for (const section of songData.sections) {
        const content = section.lines.map(l => l.text).join("\n")
        const typeStr = section.section?.type || "Verse"
        flat.push({ id: `song-${idx++}`, title: typeStr.toUpperCase(), content, sectionId: section.section?.id })
      }
      return flat
    }
    if (item?.kind === "bible" && bibleData) {
      const filtered = bibleData.filter(v => v.verse >= (item?.verse_start ?? 0) && v.verse <= (item?.verse_end ?? 0))
      return filtered.map(v => ({
        id: `bible-${v.verse}`,
        title: `${item?.book} ${item?.chapter}:${v.verse}`,
        content: v.text
      }))
    }
    return []
  }, [item, songData, bibleData])

  return { item, slides, slideState, setSlideState }
}
