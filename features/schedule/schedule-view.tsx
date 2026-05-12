import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/alert-dialog"
import { Input } from "@/components/input"
import { cn } from "@/lib/utils"
import {
  scheduleKeys,
  useSections,
  useCreateSection,
  useRenameSection,
  useDeleteSection,
  useReorderSections,
  useMoveItem,
  useSetSectionColor,
  useServices,
  useRenameService,
} from "./api"
import { ItemList } from "./item-list"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  VerticalSortable,
  useSortableRow,
  type DragEndEvent,
} from "./sortable"
import { PlayedProvider } from "./played-context"
import { sectionColor, sectionColorList } from "./section-colors"
import { PaletteIcon, XIcon, CheckIcon } from "lucide-react"

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
        <button
          type="button"
          aria-label="Add section"
          onClick={handleCreateSection}
          className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground/60">
            Loading…
          </div>
        ) : !sections || sections.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground/60">
            No sections yet. Click + to add one.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <VerticalSortable
              ids={sections.map((s) => `section-${s.id}`)}
            >
              {sections.map((section) => (
                <SectionRow
                  key={section.id}
                  section={section}
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
}: {
  section: ServiceSection
  serviceId: number
  activeItemId: number | undefined
  onSelectItem: (id: number | undefined) => void
  onAddItem: (sectionId: number) => void
  onEditItem: (itemId: number) => void
}) {
  const renameMut = useRenameSection(serviceId)
  const deleteMut = useDeleteSection(serviceId)
  const setColorMut = useSetSectionColor(serviceId)
  const { attributes, listeners, setNodeRef, style } = useSortableRow(
    `section-${section.id}`,
    { type: "section" }
  )

  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const color = sectionColor(section.color)
  const colored = color.key !== ""

  return (
    <div ref={setNodeRef} style={style} className="border-b border-border/40">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group flex items-center gap-1.5 px-2 py-1.5",
              color.header,
              color.headerText
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
                "grid size-4 place-items-center rounded transition-colors",
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
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => setEditing(true)}>
            <PencilIcon className="size-3.5" />
            Rename
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <PaletteIcon className="size-3.5" />
              Color
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {sectionColorList.map((c) => (
                <ContextMenuItem
                  key={c.key}
                  onSelect={() =>
                    setColorMut.mutate({ id: section.id, color: c.key })
                  }
                >
                  <span className={cn("size-3 rounded-full", c.swatch)} />
                  {c.label}
                  {section.color === c.key && (
                    <CheckIcon className="ml-auto size-3.5 opacity-70" />
                  )}
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem
                onSelect={() =>
                  setColorMut.mutate({ id: section.id, color: "" })
                }
              >
                <XIcon className="size-3.5" />
                None
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => setConfirmDelete(true)}
          >
            <Trash2Icon className="size-3.5" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {!collapsed && (
        <div className="pb-1">
          <ItemList
            sectionId={section.id}
            activeItemId={activeItemId}
            onSelectItem={onSelectItem}
            onEditItem={onEditItem}
            color={color}
          />
          <button
            type="button"
            onClick={() => onAddItem(section.id)}
            className="ml-7 mt-0.5 flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground"
          >
            <PlusIcon className="size-3" />
            Add
          </button>
        </div>
      )}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete section?</AlertDialogTitle>
            <AlertDialogDescription>
              All items in this section will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteMut.mutate(section.id)
                setConfirmDelete(false)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

