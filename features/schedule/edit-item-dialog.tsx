import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { MusicIcon, BookOpenIcon, LayersIcon } from "lucide-react"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog"
import { SongEditor } from "@/features/songs/song-editor"
import { BiblePicker } from "@/features/schedule/pickers/bible-picker"
import { OverlayItemEditor } from "@/features/schedule/overlay-item-editor"

type Props = {
  itemId: number | undefined
  onClose: () => void
}

const KIND_META: Record<string, { label: string; Icon: typeof MusicIcon }> = {
  song:    { label: "Edit song",       Icon: MusicIcon },
  bible:   { label: "Edit scripture",  Icon: BookOpenIcon },
  overlay: { label: "Edit overlay",    Icon: LayersIcon },
}

// EditItemDialog: resolves the item from the React Query cache (always warm
// because the user just clicked it), then opens the right full-screen editor.
export function EditItemDialog({ itemId, onClose }: Props) {
  const qc = useQueryClient()

  const [cacheTick, setCacheTick] = useState(0)
  useEffect(() => {
    const unsub = qc.getQueryCache().subscribe((evt) => {
      const key = evt.query.queryKey
      if (Array.isArray(key) && key[0] === "schedule" && key[1] === "items") {
        setCacheTick((t) => t + 1)
      }
    })
    return unsub
  }, [qc])

  const item = useMemo<ListServiceItemsWithContentRow | null>(() => {
    if (itemId === undefined) return null
    const all = qc.getQueriesData<ListServiceItemsWithContentRow[]>({
      queryKey: ["schedule", "items"],
    })
    for (const [, data] of all) {
      if (!data) continue
      const found = data.find((i) => i.id === itemId)
      if (found) return found
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, itemId, cacheTick])

  const open = itemId !== undefined
  const meta = item ? (KIND_META[item.kind] ?? null) : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90vh] max-h-[56rem] w-[95vw] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="sr-only">
          <DialogTitle>{meta?.label ?? "Edit item"}</DialogTitle>
        </DialogHeader>

        {/* Header bar */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-4 text-sm font-medium text-muted-foreground">
          {meta && <meta.Icon className="size-3.5" />}
          <span>{meta?.label ?? "Edit item"}</span>
          {item && (
            <span className="ml-2 truncate text-[11px] font-normal text-muted-foreground/60">
              {item.label}
            </span>
          )}
        </div>

        {/* Editor body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {!item && (
            <div className="grid flex-1 place-items-center text-xs text-muted-foreground/50">
              Loading…
            </div>
          )}
          {item?.kind === "song" && (
            <SongEditor
              mode="edit"
              songId={item.song_id}
              onSaved={onClose}
              onCancel={onClose}
            />
          )}
          {item?.kind === "bible" && (
            <BiblePicker
              mode="edit"
              itemId={item.id}
              initial={{
                book: item.book,
                chapter: item.chapter,
                from: item.verse_start,
                to: item.verse_end,
              }}
              onSaved={onClose}
            />
          )}
          {item?.kind === "overlay" && (
            <OverlayItemEditor item={item} onDone={onClose} />
          )}
          {item && !KIND_META[item.kind] && (
            <div className="grid flex-1 place-items-center text-xs text-muted-foreground/50">
              Editing this item type is not supported.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
