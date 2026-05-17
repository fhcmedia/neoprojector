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
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import { cn } from "@/lib/utils"
import { useItems, useDeleteItem } from "@/features/schedule/api"
import { VerticalSortable, useSortableRow } from "@/features/schedule/sortable"
import { usePlayed } from "@/features/schedule/played-context"
import { useLive } from "@/features/live/live-context"
import {
  sectionBorderClass,
  type SectionColor,
} from "@/features/schedule/section-palette"

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
  const { toggleOverlay, isOverlayActive } = useLive()
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

  const [pendingDelete, setPendingDelete] = useState(false)
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
          tinted && "bg-destructive/15 text-foreground",
          !tinted && !isActive && "text-muted-foreground hover:bg-muted hover:text-foreground",
          !tinted && isActive && "bg-muted text-foreground"
        )}
      >
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag"
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-50 hover:opacity-90"
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
                onSelect()
              }
            }}
            className="flex flex-1 items-center gap-2 py-1 text-left"
          >
            <Icon
              className={cn(
                "size-3.5 shrink-0 opacity-70",
                overlayActive && "text-emerald-500 opacity-100"
              )}
            />
            <span
              className={cn(
                "truncate",
                overlayActive && "text-emerald-500"
              )}
            >
              {label}
            </span>
          </button>
          {editable && (
            <ItemAction ariaLabel="Edit" tone="yellow" onClick={onEdit}>
              <PencilIcon className="size-3" />
            </ItemAction>
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
              "grid size-5 shrink-0 place-items-center rounded transition-all",
              pendingDelete
                ? "bg-destructive text-destructive-foreground opacity-100"
                : "text-muted-foreground opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-70 hover:!opacity-100"
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
              "relative z-[1] grid size-5 shrink-0 place-items-center rounded transition-opacity",
              played
                ? "text-emerald-500 opacity-100 hover:bg-emerald-500/15"
                : "text-muted-foreground opacity-0 group-hover:opacity-70 hover:bg-emerald-500/15 hover:text-emerald-500 hover:!opacity-100"
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
        "grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100",
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
