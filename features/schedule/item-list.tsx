import { useEffect, useRef, useState } from "react"
import {
  MusicIcon,
  BookOpenIcon,
  ImageIcon,
  FileQuestionIcon,
  FilmIcon,
  LayersIcon,
  Trash2Icon,
  GripVerticalIcon,
  CheckCircle2Icon,
  CircleIcon,
  PencilIcon,
  XIcon,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import type {
  ListServiceItemsWithContentRow,
  Medium,
} from "@/bindings/neoprojector/database"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import { cn } from "@/lib/utils"
import { useItems, useDeleteItem } from "@/features/schedule/api"
import { VerticalSortable, useSortableRow } from "@/features/schedule/sortable"
import { usePlayed } from "@/features/schedule/played-context"
import { useLive } from "@/features/live/live-context"
import { useBibleEdit } from "@/features/schedule/bible-edit-context"
import { BackgroundPicker } from "@/features/backgrounds/background-picker"
import { useSetItemBackground } from "@/features/backgrounds/api"
import { kindColor } from "@/features/schedule/kind-colors"
import {
  sectionBorderClass,
  type SectionColor,
} from "@/features/schedule/section-palette"
import { useMediaServerConn, videoAssetUrl } from "@/lib/media-url"

type Props = {
  sectionId: number
  color: SectionColor
  activeItemId: number | undefined
  onSelectItem: (id: number | undefined) => void
  onEditItem: (itemId: number) => void
  sectionPendingDelete?: boolean
}

export function ItemList({
  sectionId,
  color,
  activeItemId,
  onSelectItem,
  onEditItem,
  sectionPendingDelete = false,
}: Props) {
  const { data: items, isLoading } = useItems(sectionId)
  const deleteMut = useDeleteItem(sectionId)
  const mediaServerConn = useMediaServerConn()
  const { data: mediaList } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="px-7 py-1 text-[11px] text-muted-foreground/40">
        Loading…
      </div>
    )
  }
  if (!items || items.length === 0) {
    return null
  }

  // Hidden cache-warmer for media items in this section. Each schedule
  // row that points at a media file gets a one-pixel off-screen
  // <img>/<video preload="auto"> at mount — the browser fetches and
  // decodes the bytes into its HTTP cache, so the first time the
  // operator clicks the row the preview surface paints instantly
  // instead of spinning while bytes stream in. preload="auto" trusts
  // the browser's heuristics; for very large videos it caps at a few
  // MB rather than pulling the whole file.
  //
  // Each id is warmed by its real type: an <img> pointed at a video
  // file makes the wails asset bridge buffer the WHOLE file on the UI
  // thread (an 873 MB video froze the app ~5s every time its service
  // was opened). Ids whose type isn't known yet are skipped.
  const mediaTypeById = new Map((mediaList ?? []).map((m) => [m.id, m.type]))
  const mediaToWarm = items
    .filter((i) => i.kind === "media" && i.media_id > 0)
    .map((i) => ({ id: i.media_id, type: mediaTypeById.get(i.media_id) }))
    .filter((m) => m.type === "image" || m.type === "video" || m.type === "audio")

  return (
    <VerticalSortable ids={items.map((i) => `item-${i.id}`)}>
      <div className="flex flex-col">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            color={color}
            isActive={item.id === activeItemId}
            sectionPendingDelete={sectionPendingDelete}
            onSelect={() => onSelectItem(item.id)}
            onEdit={() => onEditItem(item.id)}
            onDelete={() => {
              deleteMut.mutate(item.id)
              if (activeItemId === item.id) onSelectItem(undefined)
            }}
          />
        ))}
      </div>
      {mediaToWarm.length > 0 && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: -100000,
            top: -100000,
            width: 1,
            height: 1,
            pointerEvents: "none",
            opacity: 0,
          }}
        >
          {mediaToWarm.map(({ id, type }) =>
            type === "image" ? (
              <img key={id} src={`/media-asset/${id}`} alt="" />
            ) : (
              <video
                key={id}
                src={videoAssetUrl(mediaServerConn, id)}
                preload="auto"
                muted
              />
            )
          )}
        </div>
      )}
    </VerticalSortable>
  )
}

function ItemRow({
  item,
  color,
  isActive,
  sectionPendingDelete,
  onSelect,
  onEdit,
  onDelete,
}: {
  item: ListServiceItemsWithContentRow
  color: SectionColor
  isActive: boolean
  sectionPendingDelete: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { isPlayed, toggle } = usePlayed()
  const played = isPlayed(item.id)
  const { live, toggleOverlay, isOverlayActive } = useLive()
  // Bible rows edit in the drawer, not the modal: the pencil arms the
  // Bible tab for this row. Which row is being edited is shown by the
  // library chip + the selected row, so the pencil itself stays a plain
  // action button (no persistent highlight).
  const { target: bibleEditTarget, begin: beginBibleEdit, cancel: cancelBibleEdit } =
    useBibleEdit()
  const { attributes, listeners, setNodeRef, style } = useSortableRow(
    `item-${item.id}`,
    { type: "item" }
  )
  const Icon = iconFor(item.kind)
  const label = labelFor(item)
  const editable =
    item.kind === "song" ||
    item.kind === "bible" ||
    item.kind === "overlay"
  const isOverlay = item.kind === "overlay"
  const overlayActive = isOverlay && isOverlayActive(item.id)
  // "Showing live" = this row is what's currently on the projector:
  // overlays when toggled active, every other kind when it's the live
  // source. A live row turns its kind color (Bible yellow, Song green, …)
  // so the operator can see at a glance what's on screen.
  const isItemLive = !isOverlay && live?.sourceItemId === item.id
  const showingLive = overlayActive || isItemLive
  const colorInfo = kindColor(item.kind)
  // Live recolors only the text/icon — the background is left to behave
  // exactly as it did before (default / hover / selected).
  const liveText = showingLive && colorInfo ? colorInfo.text : ""

  const [pendingDelete, setPendingDelete] = useState(false)
  const [bgPickerOpen, setBgPickerOpen] = useState(false)
  const setItemBgMut = useSetItemBackground()
  // Overlays stack over live content and have no z0 footprint, so a
  // per-overlay background assignment would be meaningless.
  const canHaveBackground = !isOverlay
  const rowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!pendingDelete) return
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (rowRef.current?.contains(target)) return
      setPendingDelete(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [pendingDelete])

  const tinted = pendingDelete || sectionPendingDelete

  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        rowRef.current = node
      }}
      style={style}
    >
      <div
        className={cn(
          "group relative flex w-full items-center gap-1 border-l-2 pl-5 pr-1.5 text-left text-xs transition-colors",
          sectionBorderClass(color),
          // Background — unchanged by live state (default / hover / selected).
          tinted && "bg-destructive/15",
          !tinted && isActive && "bg-muted",
          !tinted && !isActive && "hover:bg-muted",
          // Text/icon — live recolors to the kind color, else normal states.
          tinted && "text-foreground",
          !tinted && showingLive && liveText,
          !tinted && !showingLive && isActive && "text-foreground",
          !tinted && !showingLive && !isActive && "text-muted-foreground hover:text-foreground"
        )}
      >
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag"
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition group-hover:opacity-60 hover:text-foreground"
          >
            <GripVerticalIcon className="size-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              // Overlays don't preview in the Show pane — clicking
              // one toggles its active state directly, since they
              // layer on top of whatever slide is already live.
              if (isOverlay) {
                toggleOverlay({
                  scheduleItemId: item.id,
                  overlayKind: item.overlay_kind,
                  name: item.label,
                  configJSON: item.overlay_config_json,
                  layoutsJSON: item.overlay_layouts_json,
                  rulesJSON: item.overlay_rules_json,
                })
              } else {
                // Previewing a different row ends any in-progress
                // drawer edit so the edit mode never lingers unseen.
                if (bibleEditTarget && bibleEditTarget.itemId !== item.id) {
                  cancelBibleEdit()
                }
                onSelect()
              }
            }}
            className="flex flex-1 items-center gap-2 py-1 text-left"
          >
            <Icon
              className={cn(
                "size-3.5 shrink-0",
                showingLive ? "opacity-100" : "opacity-70"
              )}
            />
            <span className="truncate">{label}</span>
          </button>
          {editable && (
            <ItemAction
              ariaLabel="Edit"
              tone="yellow"
              onClick={() => {
                // Bible edits happen inline in the drawer; everything
                // else still opens the edit modal.
                if (item.kind === "bible") {
                  // Preview the row in the Show pane too, so the verse
                  // picks are visible as they happen (preview only —
                  // selecting never broadcasts to the projector).
                  onSelect()
                  beginBibleEdit({
                    itemId: item.id,
                    book: item.book,
                    bookLabel: item.book_kjv || item.book,
                    chapter: item.chapter,
                    verseStart: item.verse_start,
                    verseEnd: item.verse_end,
                  })
                } else {
                  onEdit()
                }
              }}
            >
              <PencilIcon className="size-3" />
            </ItemAction>
          )}
          {canHaveBackground && (
            <BackgroundPicker
              value={item.background_id}
              inheritLabel="Inherit"
              open={bgPickerOpen}
              onOpenChange={setBgPickerOpen}
              align="end"
              onPick={(id) =>
                setItemBgMut.mutate({ itemId: item.id, backgroundId: id })
              }
            >
              <span
                className={cn(
                  "grid",
                  // Pin the action visible while its picker is open —
                  // the row loses hover the moment the popover takes
                  // pointer focus.
                  bgPickerOpen && "[&>button]:opacity-100"
                )}
              >
                <ItemAction
                  ariaLabel="Item background"
                  tone="blue"
                  onClick={() => setBgPickerOpen(true)}
                >
                  <ImageIcon
                    className={cn(
                      "size-3",
                      item.background_id !== 0 && "text-sky-500"
                    )}
                  />
                </ItemAction>
              </span>
            </BackgroundPicker>
          )}
          <button
            type="button"
            aria-label={pendingDelete ? "Confirm remove" : "Remove"}
            onClick={(e) => {
              e.stopPropagation()
              if (pendingDelete) {
                onDelete()
                setPendingDelete(false)
              } else {
                setPendingDelete(true)
              }
            }}
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded transition",
              pendingDelete
                ? "bg-destructive text-destructive-foreground opacity-100"
                : "text-muted-foreground opacity-0 group-hover:opacity-70 hover:bg-destructive/15 hover:text-destructive"
            )}
          >
            {pendingDelete ? (
              <XIcon className="size-3" />
            ) : (
              <Trash2Icon className="size-3" />
            )}
          </button>
          <button
            type="button"
            aria-label={played ? "Unmark played" : "Mark as played"}
            onClick={(e) => {
              e.stopPropagation()
              toggle(item.id)
            }}
            className={cn(
              // Played = green icon (positive done-state, always visible).
              // Unplayed = muted hover-only, green hover tint hints the
              // affordance.
              "relative z-[1] grid size-5 shrink-0 place-items-center rounded transition",
              played
                ? "text-emerald-500 opacity-100 hover:bg-emerald-500/15"
                : "text-muted-foreground opacity-0 group-hover:opacity-70 hover:bg-emerald-500/15 hover:text-emerald-500"
            )}
          >
            {played ? (
              <CheckCircle2Icon className="size-3" />
            ) : (
              <CircleIcon className="size-3" />
            )}
          </button>
      </div>
    </div>
  )
}

type ItemActionTone = "default" | "yellow" | "blue"

const itemToneHover: Record<ItemActionTone, string> = {
  default: "hover:bg-muted hover:text-foreground",
  yellow: "hover:bg-amber-500/15 hover:text-amber-500",
  blue: "hover:bg-sky-500/15 hover:text-sky-500",
}

function ItemAction({
  ariaLabel,
  tone = "default",
  onClick,
  children,
}: {
  ariaLabel: string
  tone?: ItemActionTone
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition group-hover:opacity-70",
        itemToneHover[tone]
      )}
    >
      {children}
    </button>
  )
}

function iconFor(kind: string) {
  switch (kind) {
    case "song":
      return MusicIcon
    case "bible":
      return BookOpenIcon
    case "media":
      return ImageIcon
    case "overlay":
      return LayersIcon
    case "presentation":
      return FilmIcon
    default:
      return FileQuestionIcon
  }
}

function labelFor(item: ListServiceItemsWithContentRow): string {
  if (item.kind === "bible") {
    const range =
      item.verse_start === item.verse_end
        ? `${item.verse_start}`
        : `${item.verse_start}–${item.verse_end}`
    const bookName = item.book_kjv || item.book
    return `${bookName} ${item.chapter}:${range}`
  }
  return item.label || "(untitled)"
}
