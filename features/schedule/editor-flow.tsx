import { useState, useMemo } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useQueryClient } from "@tanstack/react-query"
import {
  MusicIcon,
  BookOpenIcon,
  ImageIcon,
  FilmIcon,
  LayersIcon,
  ArrowLeftIcon,
  XIcon,
} from "lucide-react"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import { cn } from "@/lib/utils"
import { KIND_COLOR } from "@/features/schedule/kind-colors"
import { SongEditor } from "@/features/songs/song-editor"
import { SongPicker } from "@/features/schedule/pickers/song-picker"
import { BiblePicker } from "@/features/schedule/pickers/bible-picker"
import { MediaPicker } from "@/features/schedule/pickers/media-picker"
import { OverlayPicker } from "@/features/schedule/pickers/overlay-picker"
import { PresentationPicker } from "@/features/schedule/pickers/presentation-picker"
import { OverlayItemEditor } from "@/features/schedule/overlay-item-editor"

type AddKind = "song" | "bible" | "media" | "presentation" | "overlay"

const ADD_KINDS: {
  key: AddKind
  label: string
  Icon: typeof MusicIcon
}[] = [
  { key: "song", label: "Song", Icon: MusicIcon },
  { key: "bible", label: "Bible", Icon: BookOpenIcon },
  { key: "media", label: "Media", Icon: ImageIcon },
  { key: "presentation", label: "Presentation", Icon: FilmIcon },
  { key: "overlay", label: "Overlay", Icon: LayersIcon },
]

// AddFlow: a two-step drill. Step 1 picks the item kind; step 2 shows only
// that kind's picker. A single back arrow is context-aware — it steps from
// the picker back to the kind list, and from the kind list it closes the
// panel. Narrow-column form factor.
export function AddFlow({
  sectionId,
  onDone,
  onClose,
}: {
  sectionId: number
  onDone: (newItemId?: number) => void
  // Close the whole add panel (back-out from the kind list).
  onClose: () => void
}) {
  const [kind, setKind] = useState<AddKind | null>(null)
  const meta = kind ? ADD_KINDS.find((k) => k.key === kind) : null

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        <button
          type="button"
          // Step back to the kind list when in a picker; otherwise close.
          onClick={() => (kind ? setKind(null) : onClose())}
          aria-label="Back"
          className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="flex-1 truncate text-xs font-medium tracking-tight">
          {meta ? `Add ${meta.label}` : "Add item"}
        </span>
      </div>

      {/* Steps slide horizontally — kinds sit "left", the picker drills in
         from the "right" — mirroring the bible picker's drill direction. */}
      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          {!kind ? (
            <motion.div
              key="kinds"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0"
            >
              <KindList onPick={setKind} onClose={onClose} />
            </motion.div>
          ) : (
            <motion.div
              key={`picker-${kind}`}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
              className="absolute inset-0 p-2"
            >
              {kind === "song" && (
                <SongPicker sectionId={sectionId} onAdded={onDone} />
              )}
              {kind === "bible" && (
                <BiblePicker mode="add" sectionId={sectionId} onSaved={onDone} />
              )}
              {kind === "media" && (
                <MediaPicker sectionId={sectionId} onAdded={onDone} />
              )}
              {kind === "presentation" && (
                <PresentationPicker sectionId={sectionId} onAdded={onDone} />
              )}
              {kind === "overlay" && (
                <OverlayPicker sectionId={sectionId} onAdded={onDone} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

// KindList: step 1. Full-height rows — one per item kind — each carrying a
// colored left-border accent, mirroring the song-section view. Picking a
// row drills into that kind's picker; Cancel backs out of the whole flow.
function KindList({
  onPick,
  onClose,
}: {
  onPick: (kind: AddKind) => void
  onClose: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        {ADD_KINDS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick(key)}
            className={cn(
              "group flex flex-1 items-center gap-3 border-b border-l-2 border-border/40 px-4 text-left transition-colors hover:bg-muted",
              KIND_COLOR[key].borderL
            )}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
            <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors group-hover:text-foreground">
              {label}
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex h-10 shrink-0 items-center justify-center gap-1.5 border-t border-border/40 text-xs text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3.5" />
        Cancel
      </button>
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
