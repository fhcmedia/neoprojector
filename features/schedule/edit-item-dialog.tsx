import { MusicIcon, BookOpenIcon } from "lucide-react"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog"
import { SongEditor } from "@/features/songs/song-editor"
import { BiblePicker } from "@/features/schedule/pickers/bible-picker"

type Props = {
  item: ListServiceItemsWithContentRow | null
  onClose: () => void
}

// EditItemDialog opens the appropriate editor for an existing schedule item.
// Renders nothing while `item` is null; the parent controls open/close by
// setting and clearing the item.
export function EditItemDialog({ item, onClose }: Props) {
  const open = item !== null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[95vw] max-w-none gap-0 p-0 sm:max-w-none">
        <DialogHeader className="sr-only">
          <DialogTitle>Edit item</DialogTitle>
        </DialogHeader>
        <div className="flex h-[45rem] flex-col gap-2 border-b border-border/50 px-4 pb-4">
          <div className="flex h-11 shrink-0 items-center gap-2 text-sm font-medium text-muted-foreground">
            {item?.kind === "song" && (
              <>
                <MusicIcon className="size-3.5" /> Edit song
              </>
            )}
            {item?.kind === "bible" && (
              <>
                <BookOpenIcon className="size-3.5" /> Edit scripture
              </>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
