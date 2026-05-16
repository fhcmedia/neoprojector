import { useState, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  MusicIcon,
  BookOpenIcon,
  ImageIcon,
  LayersIcon,
} from "lucide-react"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import { cn } from "@/lib/utils"
import { SongEditor } from "@/features/songs/song-editor"
import { SongPicker } from "@/features/schedule/pickers/song-picker"
import { BiblePicker } from "@/features/schedule/pickers/bible-picker"
import { MediaPicker } from "@/features/schedule/pickers/media-picker"
import { OverlayPicker } from "@/features/schedule/pickers/overlay-picker"
import { OverlayItemEditor } from "@/features/schedule/overlay-item-editor"

type AddKind = "song" | "bible" | "media" | "overlay"

// AddFlow: lets the user pick which kind of item to add, then routes to the
// matching picker. Narrow-column form factor.
export function AddFlow({
  sectionId,
  onDone,
}: {
  sectionId: number
  onDone: (newItemId?: number) => void
}) {
  const [kind, setKind] = useState<AddKind>("song")

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <KindChooser value={kind} onChange={setKind} />
      <div className="flex-1 overflow-hidden">
        {kind === "song" && (
          <SongPicker sectionId={sectionId} onAdded={onDone} />
        )}
        {kind === "bible" && (
          <BiblePicker
            mode="add"
            sectionId={sectionId}
            onSaved={onDone}
          />
        )}
        {kind === "media" && (
          <MediaPicker sectionId={sectionId} onAdded={onDone} />
        )}
        {kind === "overlay" && (
          <OverlayPicker sectionId={sectionId} onAdded={onDone} />
        )}
      </div>
    </div>
  )
}

function KindChooser({
  value,
  onChange,
}: {
  value: AddKind
  onChange: (v: AddKind) => void
}) {
  const kinds: { key: AddKind; label: string; Icon: typeof MusicIcon }[] = [
    { key: "song", label: "Song", Icon: MusicIcon },
    { key: "bible", label: "Bible", Icon: BookOpenIcon },
    { key: "media", label: "Media", Icon: ImageIcon },
    { key: "overlay", label: "Overlay", Icon: LayersIcon },
  ]
  return (
    <div className="grid grid-cols-4 gap-1 rounded-md border border-border/50 p-0.5">
      {kinds.map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors",
            value === key
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          )}
        >
          <Icon className="size-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}

// EditFlow: resolves the item from the React Query cache (warm because the
// user just right-clicked it), then renders the right editor.
export function EditFlow({
  itemId,
  onDone,
}: {
  itemId: number
  onDone: () => void
}) {
  const qc = useQueryClient()

  const item = useMemo<ListServiceItemsWithContentRow | null>(() => {
    const cached = qc.getQueriesData<ListServiceItemsWithContentRow[]>({
      queryKey: ["schedule", "items"],
    })
    for (const [, data] of cached) {
      if (!data) continue
      const found = data.find((i) => i.id === itemId)
      if (found) return found
    }
    return null
  }, [qc, itemId])

  if (!item) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60 p-3">
        Item not found in cache.
      </div>
    )
  }

  if (item.kind === "song") {
    return (
      <div className="h-full p-2">
        <SongEditor
          mode="edit"
          songId={item.song_id}
          onSaved={onDone}
          onCancel={onDone}
        />
      </div>
    )
  }

  if (item.kind === "bible") {
    return (
      <div className="h-full p-2">
        <BiblePicker
          mode="edit"
          itemId={item.id}
          initial={{
            book: item.book,
            chapter: item.chapter,
            from: item.verse_start,
            to: item.verse_end,
          }}
          onSaved={onDone}
        />
      </div>
    )
  }

  if (item.kind === "overlay") {
    return (
      <div className="h-full p-2">
        <OverlayItemEditor item={item} onDone={onDone} />
      </div>
    )
  }

  return (
    <div className="grid h-full place-items-center text-xs text-muted-foreground/60 p-3">
      Editing this item type isn't supported yet.
    </div>
  )
}
