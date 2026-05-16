import { type ReactNode } from "react"
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"

// SortableList: a self-contained DndContext + SortableContext for a single
// vertical list. Best for lists that don't need to share drag state with
// anything else (e.g. the top-level sections list).
export function SortableList<T extends { id: number }>({
  items,
  onReorder,
  children,
}: {
  items: T[]
  onReorder: (orderedIds: number[]) => void
  children: ReactNode
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = items.findIndex((i) => i.id === Number(active.id))
    const newIndex = items.findIndex((i) => i.id === Number(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(items, oldIndex, newIndex)
    onReorder(next.map((i) => i.id))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  )
}

// VerticalSortable wraps children in a SortableContext only (no DndContext).
// Use when several sortable lists need to share a single parent DndContext —
// e.g. cross-section item drag where items can move between sections.
export function VerticalSortable({
  ids,
  children,
}: {
  ids: (string | number)[]
  children: ReactNode
}) {
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      {children}
    </SortableContext>
  )
}

export {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
}
export type { DragEndEvent, DragStartEvent }

export function useSortableRow(
  id: string | number,
  data?: Record<string, unknown>
) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, data })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return { attributes, listeners, setNodeRef, style, isDragging }
}
