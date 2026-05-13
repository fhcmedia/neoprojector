import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
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
  XIcon,
} from "lucide-react"
import type { ListServiceItemsWithContentRow } from "@/bindings/neoprojector/database"
import { cn } from "@/lib/utils"
import { useItems, useDeleteItem } from "@/features/schedule/api"
import { VerticalSortable, useSortableRow } from "@/features/schedule/sortable"
import { usePlayed } from "@/features/schedule/played-context"
import type { SectionColor } from "@/features/schedule/section-colors"

type Props = {
  sectionId: number
  activeItemId: number | undefined
  onSelectItem: (id: number | undefined) => void
  onEditItem: (itemId: number) => void
  color: SectionColor
  sectionPendingDelete?: boolean
  newItemId?: number
}

export function ItemList({
  sectionId,
  activeItemId,
  onSelectItem,
  onEditItem,
  color,
  sectionPendingDelete = false,
  newItemId,
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
        <AnimatePresence initial={false}>
          {items.map((item, index) => (
            <ItemRow
              key={item.id}
              item={item}
              index={index}
              isActive={item.id === activeItemId}
              isNew={item.id === newItemId}
              color={color}
              sectionPendingDelete={sectionPendingDelete}
              onSelect={() => onSelectItem(item.id)}
              onEdit={() => onEditItem(item.id)}
              onDelete={() => {
                deleteMut.mutate(item.id)
                if (activeItemId === item.id) onSelectItem(undefined)
              }}
            />
          ))}
        </AnimatePresence>
      </div>
    </VerticalSortable>
  )
}

function ItemRow({
  item,
  index,
  isActive,
  isNew,
  color,
  sectionPendingDelete,
  onSelect,
  onEdit,
  onDelete,
}: {
  item: ListServiceItemsWithContentRow
  index: number
  isActive: boolean
  isNew: boolean
  color: SectionColor
  sectionPendingDelete: boolean
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
  const editable = item.kind === "song" || item.kind === "bible"

  const [pendingDelete, setPendingDelete] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)

  // Stagger the color transition after a section recolor OR a section
  // pending-delete tint flip: the section header retints first, then each
  // item below it in sequence. The delay must be applied in the SAME
  // render as the bg-class change so the browser-level transition picks
  // it up — setting it in an effect would fire after the transition has
  // already started without delay.
  const colorKey = color.key
  const prevColorKeyRef = useRef(colorKey)
  const prevSectionPendingRef = useRef(sectionPendingDelete)
  const colorChanging = prevColorKeyRef.current !== colorKey
  const tintChanging = prevSectionPendingRef.current !== sectionPendingDelete
  const staggerDelay =
    colorChanging || tintChanging ? (index + 1) * 28 : 0
  useEffect(() => {
    prevColorKeyRef.current = colorKey
    prevSectionPendingRef.current = sectionPendingDelete
  }, [colorKey, sectionPendingDelete])

  // dnd-kit hands us `style.transition` set to a `transform`-only
  // shorthand, which overrides Tailwind's `transition-colors` class on the
  // same element. We have to compose them ourselves so background-color
  // actually animates (and picks up our staggered delay).
  const composedTransition = [
    style.transition,
    "color 120ms cubic-bezier(0.32, 0.72, 0, 1)",
    `background-color 160ms cubic-bezier(0.32, 0.72, 0, 1) ${staggerDelay}ms`,
  ]
    .filter(Boolean)
    .join(", ")

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
    // Outer wrapper: hosts the dnd-kit sortable transform/transition and the
    // exit-collapse for delete. NO bg/scale animations here — those live on
    // the inner motion.div so we don't fight dnd-kit's transform style.
    <motion.div
      ref={(node) => {
        setNodeRef(node)
        rowRef.current = node
      }}
      style={style}
      initial={false}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        height: { duration: 0.14, ease: [0.32, 0.72, 0, 1] },
        opacity: { duration: 0.09 },
      }}
      className="overflow-hidden"
    >
      <motion.div
        // Inner: the visible row. Squeeze-in animates scale/opacity here so
        // dnd-kit can keep ownership of the outer transform. Tight spring
        // with no bounce — a snap, not a wobble.
        initial={isNew ? { scale: 0.94, opacity: 0 } : false}
        animate={isNew ? { scale: 1, opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={
          isNew
            ? { duration: 0.22, ease: [0.32, 0.72, 0, 1] }
            : { duration: 0 }
        }
        style={{ transition: composedTransition }}
        className={cn(
          "group relative flex w-full items-center gap-1 pl-3 pr-2 text-left text-xs",
          tinted && "bg-destructive/15 text-foreground",
          !tinted && !isActive && color.item,
          !tinted && !isActive && color.itemHover,
          !tinted && !isActive && "text-muted-foreground hover:text-foreground",
          !tinted && isActive && cn(color.itemActive, "text-foreground")
        )}
      >
        {/* Played indicator: green gradient flooding the right ~30% of
           the row. Sweeps in from outside the right edge with a brief
           overshoot flash so the toggle reads clearly. */}
        <AnimatePresence initial={false}>
          {played && (
            <motion.span
              key="played-glow"
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-[32%] bg-gradient-to-l from-emerald-500/55 via-emerald-500/20 to-transparent"
              initial={{ opacity: 0, x: "110%" }}
              animate={{
                opacity: [0, 1, 0.85],
                x: ["110%", "-4%", "0%"],
              }}
              exit={{ opacity: 0, x: "60%" }}
              transition={{
                duration: 0.4,
                ease: [0.32, 0.72, 0, 1],
                times: [0, 0.7, 1],
              }}
            />
          )}
        </AnimatePresence>
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
            "relative z-[1] grid size-5 shrink-0 place-items-center rounded transition-opacity hover:bg-sky-500/15 hover:text-sky-500",
            played
              ? "text-emerald-500/80 opacity-100"
              : "text-muted-foreground opacity-0 group-hover:opacity-70 hover:!opacity-100"
          )}
        >
          {played ? (
            <CheckCircle2Icon className="size-3" />
          ) : (
            <CircleIcon className="size-3" />
          )}
        </button>
      </motion.div>
    </motion.div>
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
