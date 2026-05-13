import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowLeftIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  Trash2Icon,
  PencilIcon,
  GripVerticalIcon,
} from "lucide-react"
import type {
  ListServiceItemsWithContentRow,
  ServiceSection,
} from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"
import { cn } from "@/lib/utils"
import {
  scheduleKeys,
  useItems,
  useSections,
  useCreateSection,
  useRenameSection,
  useDeleteSection,
  useReorderSections,
  useMoveItem,
  useSetSectionColor,
  useServices,
  useRenameService,
} from "@/features/schedule/api"
import { ItemList } from "@/features/schedule/item-list"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  VerticalSortable,
  useSortableRow,
  type DragEndEvent,
} from "@/features/schedule/sortable"
import { PlayedProvider } from "@/features/schedule/played-context"
import { sectionColor, sectionColorList } from "@/features/schedule/section-colors"
import { PaletteIcon, XIcon } from "lucide-react"
import { AddArea } from "@/components/add-area"

type Props = {
  serviceId: number
  onBack: () => void
  activeItemId: number | undefined
  onSelectItem: (id: number | undefined) => void
  onAddItem: (sectionId: number) => void
  onEditItem: (itemId: number) => void
  newItemId?: number
  autoEditName?: boolean
  onAutoEditConsumed?: () => void
}

// Palette dot animation: container drives the stagger, dots define their
// own keyframes. staggerDirection flips on exit so the rightmost dot is
// the first to leave.
const paletteContainerVariants = {
  open: {
    transition: { staggerChildren: 0.025, staggerDirection: 1 },
  },
  closed: {
    transition: {
      staggerChildren: 0.025,
      staggerDirection: -1,
    },
  },
}

const paletteDotVariants = {
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.12, ease: "easeOut" as const },
  },
  closed: {
    opacity: 0,
    y: 4,
    scale: 0.7,
    transition: { duration: 0.1 },
  },
}

// Icons live "above" the visible row when hidden — pairing with dots
// coming up from below creates a coordinated vertical swap on open;
// closing reverses, so icons drop down from above while dots fall away.
const actionsVariants = {
  hidden: { opacity: 0, y: -4, transition: { duration: 0.1 } },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.12, ease: "easeOut" as const },
  },
}

export function ScheduleView({
  serviceId,
  onBack,
  activeItemId,
  onSelectItem,
  onAddItem,
  onEditItem,
  newItemId,
  autoEditName = false,
  onAutoEditConsumed,
}: Props) {
  const { data: services } = useServices()
  const service = services?.find((s) => s.id === serviceId)
  const renameServiceMut = useRenameService()
  const [editingName, setEditingName] = useState(false)

  // When the user lands here by creating a new service, the parent passes
  // autoEditName=true exactly once. Consume it so the rename input opens
  // immediately — replaces the old inline-edit-in-the-list flash.
  useEffect(() => {
    if (!autoEditName) return
    setEditingName(true)
    onAutoEditConsumed?.()
  }, [autoEditName, onAutoEditConsumed])

  const { data: sections, isLoading } = useSections(serviceId)
  const createSectionMut = useCreateSection(serviceId)
  const reorderSectionsMut = useReorderSections(serviceId)
  const moveItemMut = useMoveItem()

  const qc = useQueryClient()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  function handleCreateSection() {
    createSectionMut.mutate("Untitled section")
  }

  // Locate which section a given item currently lives in by scanning the
  // React Query item-cache families. Returns null if unknown (e.g. items for
  // that section haven't been loaded yet).
  function locateItem(itemId: number): {
    sectionId: number
    position: number
    items: ListServiceItemsWithContentRow[]
  } | null {
    const cached = qc.getQueriesData<ListServiceItemsWithContentRow[]>({
      queryKey: ["schedule", "items"],
    })
    for (const [key, data] of cached) {
      if (!data) continue
      const idx = data.findIndex((i) => i.id === itemId)
      if (idx >= 0) {
        return {
          sectionId: Number(key[2]),
          position: idx,
          items: data,
        }
      }
    }
    return null
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const aType = (active.data.current as { type?: string } | undefined)?.type
    const oType = (over.data.current as { type?: string } | undefined)?.type

    // SECTION reorder — sections drag among themselves only.
    if (aType === "section" && oType === "section") {
      if (active.id === over.id || !sections) return
      const oldIdx = sections.findIndex((s) => `section-${s.id}` === active.id)
      const newIdx = sections.findIndex((s) => `section-${s.id}` === over.id)
      if (oldIdx < 0 || newIdx < 0) return
      const next = [...sections]
      const [moved] = next.splice(oldIdx, 1)
      next.splice(newIdx, 0, moved)
      reorderSectionsMut.mutate(next.map((s) => s.id))
      return
    }

    // ITEM drag.
    if (aType === "item") {
      const itemId = Number(String(active.id).replace(/^item-/, ""))
      const source = locateItem(itemId)
      if (!source) return

      // Dropped on another item.
      if (oType === "item") {
        const overItemId = Number(String(over.id).replace(/^item-/, ""))
        const target = locateItem(overItemId)
        if (!target) return

        if (target.sectionId === source.sectionId) {
          // Same-section reorder.
          if (source.position === target.position) return
          const next = [...source.items]
          const [moved] = next.splice(source.position, 1)
          next.splice(target.position, 0, moved)
          // Issue reorder directly via the cache-aware mutation.
          qc.setQueryData(
            scheduleKeys.items(source.sectionId),
            next.map((it, idx) => ({ ...it, position: idx }))
          )
          moveItemMut.mutate({
            itemId,
            targetSectionId: source.sectionId,
            position: target.position,
          })
        } else {
          // Cross-section move at the over item's position.
          moveItemMut.mutate({
            itemId,
            targetSectionId: target.sectionId,
            position: target.position,
          })
        }
        return
      }

      // Dropped on a section header → append to that section.
      if (oType === "section") {
        const targetSectionId = Number(
          String(over.id).replace(/^section-/, "")
        )
        if (targetSectionId === source.sectionId) return
        const targetItems =
          qc.getQueryData<ListServiceItemsWithContentRow[]>(
            scheduleKeys.items(targetSectionId)
          ) ?? []
        moveItemMut.mutate({
          itemId,
          targetSectionId,
          position: targetItems.length,
        })
        return
      }
    }
  }

  return (
    <PlayedProvider serviceId={serviceId}>
      <div className="flex h-full w-full flex-col bg-background">
        <div className="flex h-7 items-center gap-1 border-b border-border/50 px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to services"
          className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        {editingName && service ? (
          <Input
            autoFocus
            defaultValue={service.name}
            onBlur={(e) => {
              setEditingName(false)
              const value = e.target.value.trim()
              if (value && value !== service.name) {
                renameServiceMut.mutate({ id: service.id, name: value })
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
              if (e.key === "Escape") setEditingName(false)
            }}
            className="h-5 flex-1 px-1.5 py-0 text-xs"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditingName(true)}
            className="flex-1 truncate text-left text-xs font-medium tracking-tight"
          >
            {service?.name ?? "…"}
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground/60">
            Loading…
          </div>
        ) : (
          <>
            {sections && sections.length > 0 && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <VerticalSortable
                  ids={sections.map((s) => `section-${s.id}`)}
                >
                  {/* initial={false} suppresses enter animations for
                     existing rows on AnimatePresence's first render —
                     but new sections added later still animate in via
                     their own `initial` prop. That's the behavior we
                     want: instant on schedule load, subtle on add. */}
                  <AnimatePresence initial={false}>
                    {sections.map((section) => (
                      <SectionRow
                        key={section.id}
                        section={section}
                        serviceId={serviceId}
                        activeItemId={activeItemId}
                        onSelectItem={onSelectItem}
                        onAddItem={onAddItem}
                        onEditItem={onEditItem}
                        newItemId={newItemId}
                      />
                    ))}
                  </AnimatePresence>
                </VerticalSortable>
              </DndContext>
            )}
            <AddArea
              hasContent={!!sections && sections.length > 0}
              onClick={handleCreateSection}
              fullLabel="Click to add your first section"
              hoverLabel="Add new section"
            />
          </>
        )}
        </div>
      </div>
    </PlayedProvider>
  )
}

function SectionRow({
  section,
  serviceId,
  activeItemId,
  onSelectItem,
  onAddItem,
  onEditItem,
  newItemId,
}: {
  section: ServiceSection
  serviceId: number
  activeItemId: number | undefined
  onSelectItem: (id: number | undefined) => void
  onAddItem: (sectionId: number) => void
  onEditItem: (itemId: number) => void
  newItemId?: number
}) {
  const renameMut = useRenameSection(serviceId)
  const deleteMut = useDeleteSection(serviceId)
  const setColorMut = useSetSectionColor(serviceId)
  // Empty sections delete without confirm — there's nothing to lose, so the
  // confirm step is just friction. Pull the items list from cache so this
  // doesn't trigger an extra fetch.
  const { data: items } = useItems(section.id)
  const isEmpty = !items || items.length === 0
  const { attributes, listeners, setNodeRef, style } = useSortableRow(
    `section-${section.id}`,
    { type: "section" }
  )

  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const headerRef = useRef<HTMLDivElement>(null)

  // Reset transient action states (pending delete, palette swatches) when
  // the user clicks anywhere outside the section header.
  useEffect(() => {
    if (!pendingDelete && !paletteOpen) return
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (headerRef.current?.contains(target)) return
      setPendingDelete(false)
      setPaletteOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [pendingDelete, paletteOpen])

  const color = sectionColor(section.color)
  const colored = color.key !== ""

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        height: { duration: 0.22, ease: [0.32, 0.72, 0, 1] },
        opacity: { duration: 0.14, ease: "easeOut" },
      }}
      className="overflow-hidden border-b border-border/40"
    >
      <div
        ref={headerRef}
        className={cn(
          "group flex items-center gap-1.5 px-2 py-1.5 transition-colors duration-200",
          pendingDelete
            ? "bg-destructive/25 text-foreground"
            : cn(color.header, color.headerText)
        )}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag section"
          className={cn(
            "cursor-grab touch-none px-0.5 opacity-0 transition-opacity group-hover:opacity-50 hover:opacity-90",
            colored ? "text-foreground/80" : "text-muted-foreground"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVerticalIcon className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={cn(
            "grid size-4 place-items-center rounded opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100",
            colored
              ? "text-foreground/80 hover:text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? (
            <ChevronRightIcon className="size-3" />
          ) : (
            <ChevronDownIcon className="size-3" />
          )}
        </button>
        {editing ? (
          <Input
            autoFocus
            defaultValue={section.name}
            onBlur={(e) => {
              setEditing(false)
              const value = e.target.value.trim()
              if (value && value !== section.name) {
                renameMut.mutate({ id: section.id, name: value })
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
              if (e.key === "Escape") setEditing(false)
            }}
            className="h-5 flex-1 px-1.5 py-0 text-xs"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditing(true)}
            className="flex-1 truncate text-left text-[11px] font-semibold uppercase tracking-wider"
          >
            {section.name}
          </button>
        )}
        <div className="grid min-w-[7.25rem]">
          <AnimatePresence mode="popLayout" initial={false}>
            {paletteOpen ? (
              <motion.div
                key="palette-dots"
                className="col-start-1 row-start-1 flex items-center justify-end gap-1"
                variants={paletteContainerVariants}
                initial="closed"
                animate="open"
                exit="closed"
              >
                {sectionColorList.map((c) => {
                  const active = c.key === section.color
                  return (
                    <motion.button
                      key={c.key}
                      type="button"
                      aria-label={`Color ${c.label}`}
                      variants={paletteDotVariants}
                      onClick={(e) => {
                        e.stopPropagation()
                        const next = active ? "" : c.key
                        setColorMut.mutate({ id: section.id, color: next })
                        setPaletteOpen(false)
                      }}
                      className="grid size-5 shrink-0 place-items-center rounded"
                    >
                      <span
                        className={cn(
                          "size-3 rounded-full transition-transform hover:scale-125",
                          c.swatch,
                          active &&
                            "ring-2 ring-foreground/70 ring-offset-1 ring-offset-background"
                        )}
                      />
                    </motion.button>
                  )
                })}
              </motion.div>
            ) : (
              <motion.div
                key="action-icons"
                className="col-start-1 row-start-1 flex items-center justify-end gap-1"
                variants={actionsVariants}
                initial="hidden"
                animate="visible"
                exit="hidden"
              >
                <SectionAction
                  colored={colored}
                  ariaLabel="Rename"
                  tone="yellow"
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon className="size-3" />
                </SectionAction>
                <SectionAction
                  colored={colored}
                  ariaLabel="Color"
                  tone="purple"
                  onClick={() => setPaletteOpen(true)}
                >
                  <PaletteIcon className="size-3" />
                </SectionAction>
                <button
                  type="button"
                  aria-label={pendingDelete ? "Confirm delete" : "Delete"}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isEmpty) {
                      deleteMut.mutate(section.id)
                      setPendingDelete(false)
                      return
                    }
                    if (pendingDelete) {
                      deleteMut.mutate(section.id)
                      setPendingDelete(false)
                    } else {
                      setPendingDelete(true)
                    }
                  }}
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded transition-all",
                    pendingDelete
                      ? "bg-destructive text-destructive-foreground opacity-100"
                      : cn(
                          "opacity-0 group-hover:opacity-70 hover:!opacity-100",
                          colored
                            ? "text-foreground/80 hover:bg-destructive/20 hover:text-destructive"
                            : "text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                        )
                  )}
                >
                  {pendingDelete ? (
                    <XIcon className="size-3" />
                  ) : (
                    <Trash2Icon className="size-3" />
                  )}
                </button>
                <SectionAction
                  colored={colored}
                  ariaLabel="Add item"
                  tone="green"
                  onClick={() => onAddItem(section.id)}
                >
                  <PlusIcon className="size-3" />
                </SectionAction>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="section-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.16, ease: [0.32, 0.72, 0, 1] },
              opacity: { duration: 0.1 },
            }}
            className="overflow-hidden"
          >
            <ItemList
              sectionId={section.id}
              activeItemId={activeItemId}
              onSelectItem={onSelectItem}
              onEditItem={onEditItem}
              color={color}
              sectionPendingDelete={pendingDelete}
              newItemId={newItemId}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

type ActionTone = "default" | "green" | "yellow" | "purple"

const toneHover: Record<ActionTone, string> = {
  default: "hover:bg-muted hover:text-foreground",
  green: "hover:bg-emerald-500/15 hover:text-emerald-500",
  yellow: "hover:bg-amber-500/15 hover:text-amber-500",
  purple: "hover:bg-violet-500/15 hover:text-violet-500",
}

function SectionAction({
  colored,
  ariaLabel,
  tone = "default",
  onClick,
  children,
}: {
  colored: boolean
  ariaLabel: string
  tone?: ActionTone
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
        "grid size-5 shrink-0 place-items-center rounded opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100",
        colored ? "text-foreground/80" : "text-muted-foreground",
        toneHover[tone]
      )}
    >
      {children}
    </button>
  )
}
