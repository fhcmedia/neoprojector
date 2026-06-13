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
  ImageIcon,
  PaletteIcon,
  XIcon,
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
import { DefaultsSection } from "@/features/schedule/defaults-section"
import { BackgroundPicker } from "@/features/backgrounds/background-picker"
import { useSetSectionBackground } from "@/features/backgrounds/api"
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
import {
  resolveSectionColor,
  sectionBorderClass,
  sectionTextClass,
  sectionSwatchClass,
  PALETTE_COLORS,
} from "@/features/schedule/section-palette"
import { AddArea } from "@/components/add-area"

// Palette swap animations — when the user opens the color picker the
// per-action icons fade up and the colored dots cascade in from below.
// staggerDirection flips on close so the rightmost dot leaves first.
const paletteContainerVariants = {
  open: { transition: { staggerChildren: 0.025, staggerDirection: 1 } },
  closed: { transition: { staggerChildren: 0.025, staggerDirection: -1 } },
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

const actionsVariants = {
  hidden: { opacity: 0, y: -4, transition: { duration: 0.1 } },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.12, ease: "easeOut" as const },
  },
}

type Props = {
  serviceId: number
  onBack: () => void
  activeItemId: number | undefined
  onSelectItem: (id: number | undefined) => void
  onAddItem: (sectionId: number) => void
  onEditItem: (itemId: number) => void
}

export function ScheduleView({
  serviceId,
  onBack,
  activeItemId,
  onSelectItem,
  onAddItem,
  onEditItem,
}: Props) {
  const { data: services } = useServices()
  const service = services?.find((s) => s.id === serviceId)
  const renameServiceMut = useRenameService()
  const [editingName, setEditingName] = useState(false)

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
          // Cross-section: optimistically remove from source and insert
          // into target so the row doesn't visually freeze waiting for the
          // mutate + refetch roundtrip.
          const newSource = [...source.items]
          const [moved] = newSource.splice(source.position, 1)
          const newTarget = [...target.items]
          newTarget.splice(target.position, 0, {
            ...moved,
            section_id: target.sectionId,
          })
          qc.setQueryData(
            scheduleKeys.items(source.sectionId),
            newSource.map((it, idx) => ({ ...it, position: idx }))
          )
          qc.setQueryData(
            scheduleKeys.items(target.sectionId),
            newTarget.map((it, idx) => ({ ...it, position: idx }))
          )
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
        // Optimistic: same as cross-section-on-item, but appending.
        const newSource = [...source.items]
        const [moved] = newSource.splice(source.position, 1)
        const newTarget = [...targetItems, { ...moved, section_id: targetSectionId }]
        qc.setQueryData(
          scheduleKeys.items(source.sectionId),
          newSource.map((it, idx) => ({ ...it, position: idx }))
        )
        qc.setQueryData(
          scheduleKeys.items(targetSectionId),
          newTarget.map((it, idx) => ({ ...it, position: idx }))
        )
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
            <DefaultsSection serviceId={serviceId} />
            {sections && sections.length > 0 && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <VerticalSortable
                  ids={sections.map((s) => `section-${s.id}`)}
                >
                  {sections.map((section, idx) => (
                    <SectionRow
                      key={section.id}
                      section={section}
                      colorIndex={idx}
                      serviceId={serviceId}
                      activeItemId={activeItemId}
                      onSelectItem={onSelectItem}
                      onAddItem={onAddItem}
                      onEditItem={onEditItem}
                    />
                  ))}
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
  colorIndex,
  serviceId,
  activeItemId,
  onSelectItem,
  onAddItem,
  onEditItem,
}: {
  section: ServiceSection
  colorIndex: number
  serviceId: number
  activeItemId: number | undefined
  onSelectItem: (id: number | undefined) => void
  onAddItem: (sectionId: number) => void
  onEditItem: (itemId: number) => void
}) {
  const renameMut = useRenameSection(serviceId)
  const deleteMut = useDeleteSection(serviceId)
  const setColorMut = useSetSectionColor(serviceId)
  const setBgMut = useSetSectionBackground(serviceId)
  // Empty sections delete without confirm — there's nothing to lose, so the
  // confirm step is just friction. Pull the items list from cache so this
  // doesn't trigger an extra fetch.
  const { data: items } = useItems(section.id)
  const isEmpty = !items || items.length === 0
  const { attributes, listeners, setNodeRef, style } = useSortableRow(
    `section-${section.id}`,
    { type: "section" }
  )

  const color = resolveSectionColor(section.color, colorIndex)

  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [bgPickerOpen, setBgPickerOpen] = useState(false)
  const sectionBgId = section.background_id?.Valid
    ? section.background_id.Int64
    : 0
  const headerRef = useRef<HTMLDivElement>(null)

  // Reset transient state (pending-delete, open palette) when the user
  // clicks anywhere outside the header.
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

  return (
    <div ref={setNodeRef} style={style} className="border-b border-border/40">
      <div
        ref={headerRef}
        className={cn(
          "group relative flex items-center gap-1 border-l-2 pl-1.5 pr-1.5 py-1.5 transition-colors duration-200",
          sectionBorderClass(color),
          pendingDelete
            ? "bg-destructive/25 text-foreground"
            : "text-muted-foreground/80"
        )}
      >
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag section"
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab touch-none grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-50 hover:opacity-90"
        >
          <GripVerticalIcon className="size-3" />
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
            className={cn(
              "flex-1 truncate text-left text-[11px] font-semibold uppercase tracking-wider",
              // Title takes the section's color (updates live when changed),
              // except while confirming delete where the row turns destructive.
              pendingDelete ? "text-foreground" : sectionTextClass(color)
            )}
          >
            {section.name}
          </button>
        )}
        <div
          className={cn(
            // Out of flow so the title keeps full width; the icons overlay
            // the title's tail on hover, masked by a fade-to-background so
            // the text disappears cleanly under them. Palette-open and
            // pending-delete pin it visible regardless of hover.
            "absolute inset-y-0 right-1.5 grid items-center bg-gradient-to-l from-background via-background to-transparent pl-10 transition-opacity",
            paletteOpen || pendingDelete || bgPickerOpen
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100"
          )}
        >
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
                {PALETTE_COLORS.map((c) => {
                  const active = c === color
                  return (
                    <motion.button
                      key={c}
                      type="button"
                      aria-label={`Color ${c}`}
                      variants={paletteDotVariants}
                      onClick={(e) => {
                        e.stopPropagation()
                        setColorMut.mutate({ id: section.id, color: c })
                        setPaletteOpen(false)
                      }}
                      className="grid size-5 shrink-0 place-items-center rounded"
                    >
                      <span
                        className={cn(
                          "size-3 rounded-full transition-transform hover:scale-125",
                          sectionSwatchClass(c),
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
                  ariaLabel="Rename"
                  tone="yellow"
                  onClick={() => setEditing(true)}
                >
                  <PencilIcon className="size-3" />
                </SectionAction>
                <SectionAction
                  ariaLabel="Color"
                  tone="purple"
                  onClick={() => setPaletteOpen(true)}
                >
                  <PaletteIcon className="size-3" />
                </SectionAction>
                <BackgroundPicker
                  value={sectionBgId}
                  inheritLabel="Inherit"
                  open={bgPickerOpen}
                  onOpenChange={setBgPickerOpen}
                  align="end"
                  onPick={(id) =>
                    setBgMut.mutate({ sectionId: section.id, backgroundId: id })
                  }
                >
                  {/* Filled icon state marks a configured override so
                      the operator can spot section backgrounds at a
                      glance without opening the picker. */}
                  <span className="grid">
                    <SectionAction
                      ariaLabel="Section background"
                      tone="green"
                      onClick={() => setBgPickerOpen(true)}
                    >
                      <ImageIcon
                        className={cn(
                          "size-3",
                          sectionBgId !== 0 && "text-emerald-500"
                        )}
                      />
                    </SectionAction>
                  </span>
                </BackgroundPicker>
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
                      : "text-muted-foreground opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-70 hover:!opacity-100"
                  )}
                >
                  {pendingDelete ? (
                    <XIcon className="size-3" />
                  ) : (
                    <Trash2Icon className="size-3" />
                  )}
                </button>
                <SectionAction
                  ariaLabel="Add item"
                  tone="green"
                  onClick={() => onAddItem(section.id)}
                >
                  <PlusIcon className="size-3" />
                </SectionAction>
                <button
                  type="button"
                  onClick={() => setCollapsed((v) => !v)}
                  className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={collapsed ? "Expand" : "Collapse"}
                >
                  {collapsed ? (
                    <ChevronRightIcon className="size-3" />
                  ) : (
                    <ChevronDownIcon className="size-3" />
                  )}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="items"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            style={{ overflow: "hidden" }}
          >
            <ItemList
              sectionId={section.id}
              color={color}
              activeItemId={activeItemId}
              onSelectItem={onSelectItem}
              onEditItem={onEditItem}
              sectionPendingDelete={pendingDelete}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

type ActionTone = "default" | "green" | "yellow" | "purple"

const toneHover: Record<ActionTone, string> = {
  default: "hover:bg-muted hover:text-foreground",
  green: "hover:bg-emerald-500/15 hover:text-emerald-500",
  purple: "hover:bg-violet-500/15 hover:text-violet-500",
  yellow: "hover:bg-amber-500/15 hover:text-amber-500",
}

function SectionAction({
  ariaLabel,
  tone = "default",
  onClick,
  children,
}: {
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
        "grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-70 hover:!opacity-100",
        toneHover[tone]
      )}
    >
      {children}
    </button>
  )
}

