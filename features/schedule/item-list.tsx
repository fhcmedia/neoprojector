import { useState } from "react"
import {
  MusicIcon,
  BookOpenIcon,
  ImageIcon,
  FileQuestionIcon,
  Trash2Icon,
  GripVerticalIcon,
  CheckCircle2Icon,
  CircleIcon,
  PencilIcon,
} from "lucide-react"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/context-menu"
import { cn } from "@/lib/utils"
import { useItems, useDeleteItem } from "./api"
import { VerticalSortable, useSortableRow } from "./sortable"
import { usePlayed } from "./played-context"
import type { SectionColor } from "./section-colors"
import { EditItemDialog } from "./edit-item-dialog"

type Props = {
  sectionId: number
  activeItemId: number | undefined
  onSelectItem: (id: number | undefined) => void
  color: SectionColor
}

export function ItemList({
  sectionId,
  activeItemId,
  onSelectItem,
  color,
}: Props) {
  const { data: items, isLoading } = useItems(sectionId)
  const deleteMut = useDeleteItem(sectionId)
  const [editingItem, setEditingItem] =
    useState<ListServiceItemsWithContentRow | null>(null)

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
    <>
      <VerticalSortable ids={items.map((i) => `item-${i.id}`)}>
        <div className="flex flex-col">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              isActive={item.id === activeItemId}
              color={color}
              onSelect={() => onSelectItem(item.id)}
              onEdit={() => setEditingItem(item)}
              onDelete={() => {
                deleteMut.mutate(item.id)
                if (activeItemId === item.id) onSelectItem(undefined)
              }}
            />
          ))}
        </div>
      </VerticalSortable>
      <EditItemDialog
        item={editingItem}
        onClose={() => setEditingItem(null)}
      />
    </>
  )
}

function ItemRow({
  item,
  isActive,
  color,
  onSelect,
  onEdit,
  onDelete,
}: {
  item: ListServiceItemsWithContentRow
  isActive: boolean
  color: SectionColor
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { isPlayed, toggle } = usePlayed()
  const played = isPlayed(item.id)
  const { attributes, listeners, setNodeRef, style } = useSortableRow(
    `item-${item.id}`,
    { type: "item" }
  )
  const Icon = iconFor(item.kind)
  const label = labelFor(item)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          className={cn(
            "group flex w-full items-center gap-1 pl-3 pr-2 text-left text-xs transition-colors",
            // Resting state: section color (dimmer than the header) or none.
            !isActive && color.item,
            // Hover state: section-color variant for colored sections, muted
            // gray fallback for the default/no-color section.
            !isActive && color.itemHover,
            !isActive && "text-muted-foreground hover:text-foreground",
            isActive && cn(color.itemActive, "text-foreground")
          )}
        >
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag"
            className="cursor-grab touch-none px-1 opacity-0 group-hover:opacity-60 hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVerticalIcon className="size-3" />
          </button>
          <button
            type="button"
            onClick={onSelect}
            className="flex flex-1 items-center gap-2 py-1 text-left"
          >
            <Icon className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">{label}</span>
            {played && (
              <CheckCircle2Icon className="ml-auto size-3 shrink-0 text-emerald-500/80" />
            )}
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {(item.kind === "song" || item.kind === "bible") && (
          <ContextMenuItem onSelect={onEdit}>
            <PencilIcon className="size-3.5" />
            Edit
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => toggle(item.id)}>
          {played ? (
            <>
              <CircleIcon className="size-3.5" />
              Unmark played
            </>
          ) : (
            <>
              <CheckCircle2Icon className="size-3.5" />
              Mark as played
            </>
          )}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2Icon className="size-3.5" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
