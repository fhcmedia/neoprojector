import { useEffect, useState, useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { 
  DndContext, 
  PointerSensor, 
  closestCenter, 
  useSensor, 
  useSensors,
  DragOverlay,
  type DragEndEvent
} from "@dnd-kit/core"
import { 
  SortableContext, 
  arrayMove, 
  useSortable, 
  rectSortingStrategy
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useSlides } from "./use-slides"
import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import { cn } from "@/lib/utils"
import { songSectionType } from "@/features/songs/section-types"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/context-menu"
import { Trash2Icon, PlusIcon } from "lucide-react"
import { libraryKeys } from "@/features/library/api"
import { ContextMenuSeparator } from "@/components/context-menu"

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.02,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  visible: { 
    opacity: 1, 
    y: 0, 
    scale: 1,
    transition: {
      duration: 0.2,
      ease: [0.32, 0.72, 0, 1]
    }
  },
}

export function PreviewPane({ 
  activeItemId, 
  onDoubleClickSlide 
}: { 
  activeItemId?: number
  onDoubleClickSlide?: (slideId: string) => void
}) {
  const qc = useQueryClient()
  const { slides, item, slideState } = useSlides(activeItemId)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<{ title: string, content: string }[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  const handleCopy = useCallback(() => {
    const selectedSlides = slides.filter(s => selectedIds.has(s.id))
    if (selectedSlides.length > 0) {
      setClipboard(selectedSlides.map(s => ({ 
        title: s.title.split(" ")[0],
        content: s.content 
      })))
    }
  }, [slides, selectedIds])

  const handlePaste = useCallback(async () => {
    if (!item || item.kind !== "song" || !item.song_id || clipboard.length === 0) return
    for (const clip of clipboard) {
      const section = await Songs.CreateSongSection(item.song_id, clip.title)
      await Songs.ReplaceSectionLines(section.id, clip.content)
    }
    await Promise.all([
      qc.refetchQueries({ queryKey: libraryKeys.song(item.song_id) }),
      qc.refetchQueries({ queryKey: libraryKeys.songs }),
      qc.refetchQueries({ queryKey: ["schedule", "items"] })
    ])
  }, [item, clipboard, qc])

  const handleDelete = useCallback(async () => {
    if (selectedIds.size === 0 || !item) return
    if (item.kind === "song") {
      const idsToDelete = Array.from(selectedIds)
        .map(id => slides.find(s => s.id === id)?.sectionId)
        .filter((id): id is number => id !== undefined)
      if (idsToDelete.length > 0) {
        for (const sid of idsToDelete) {
          await Songs.DeleteSongSection(sid)
        }
      }
    }
    setSelectedIds(new Set())
    qc.invalidateQueries({ queryKey: libraryKeys.song(item.song_id) })
    qc.invalidateQueries({ queryKey: libraryKeys.songs })
    qc.invalidateQueries({ queryKey: ["schedule", "items"] })
  }, [item, slides, selectedIds, qc])

  const handleAddSlide = useCallback(async (type: string = "VERSE") => {
    if (!item || item.kind !== "song" || !item.song_id) return
    const section = await Songs.CreateSongSection(item.song_id, type)
    await Songs.ReplaceSectionLines(section.id, "New slide content")
    qc.invalidateQueries({ queryKey: libraryKeys.song(item.song_id) })
    qc.invalidateQueries({ queryKey: libraryKeys.songs })
    qc.invalidateQueries({ queryKey: ["schedule", "items"] })
  }, [item, qc])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "c") handleCopy()
      if ((e.ctrlKey || e.metaKey) && e.key === "v") handlePaste()
      if (e.key === "Delete" || e.key === "Backspace") {
        if (document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
          handleDelete()
        }
      }
      if (e.key === "Escape") setSelectedIds(new Set())
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleCopy, handlePaste, handleDelete])

  const toggleSelect = (id: string, multi: boolean, shift: boolean) => {
    setSelectedIds(prev => {
      let next = new Set(prev)
      if (shift && lastSelectedId) {
        const start = slides.findIndex(s => s.id === lastSelectedId)
        const end = slides.findIndex(s => s.id === id)
        if (start >= 0 && end >= 0) {
          const range = slides.slice(Math.min(start, end), Math.max(start, end) + 1)
          range.forEach(s => next.add(s.id))
        }
      } else {
        if (!multi) next = new Set()
        if (next.has(id)) next.delete(id)
        else next.add(id)
      }
      return next
    })
    setLastSelectedId(id)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragStart = (event: { active: { id: any } }) => {
    setActiveId(String(event.active.id))
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id || !item || item.kind !== "song" || !item.song_id) return
    const oldIndex = slides.findIndex(s => s.id === active.id)
    const newIndex = slides.findIndex(s => s.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(slides, oldIndex, newIndex)
    const sectionIds = next.map(s => s.sectionId).filter((id): id is number => id !== undefined)
    await Songs.ReorderSongSections(sectionIds)
    qc.invalidateQueries({ queryKey: libraryKeys.song(item.song_id) })
    qc.invalidateQueries({ queryKey: ["schedule", "items"] })
  }

  const activeSlidePreview = useMemo(() => slides.find(s => s.id === activeId), [slides, activeId])

  if (!activeItemId || !item) {
    return (
      <div className="relative h-full w-full bg-background flex flex-col border-r border-border/50">
        <div className="flex h-10 shrink-0 items-center px-4 border-b border-border/50 bg-muted/10">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
            Slide Viewer
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground/40">
          Select an item in the schedule to view slides
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full flex flex-col bg-background overflow-hidden border-r border-border/50">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center px-4 border-b border-border/50 bg-muted/10">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {item.label || "Item"}
        </span>
      </div>
      
      {/* Slide Grid Area */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar min-h-0 bg-background/50">
            {slides.length === 0 ? (
              <div className="group flex flex-col items-center justify-center h-full text-xs text-muted-foreground/0 hover:text-muted-foreground/40 gap-4 transition-colors">
                <div className="size-12 rounded-full border border-dashed border-muted-foreground/0 group-hover:border-muted-foreground/20 flex items-center justify-center transition-colors">
                  <Trash2Icon className="size-5 rotate-45 opacity-0 group-hover:opacity-20 transition-opacity" />
                </div>
                <p className="opacity-0 group-hover:opacity-100 transition-opacity">No slides available. Right-click to add.</p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={slides.map(s => s.id)} strategy={rectSortingStrategy}>
                  <motion.div 
                    key={item.id}
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                    className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3"
                  >
                    {slides.map((slide, idx) => (
                      <SortableSlide
                        key={slide.id}
                        slide={slide}
                        idx={idx}
                        isSelected={selectedIds.has(slide.id)}
                        toggleSelect={toggleSelect}
                        onDoubleClickSlide={onDoubleClickSlide}
                        onDelete={handleDelete}
                        slideState={slideState}
                      />
                    ))}
                  </motion.div>
                </SortableContext>

                <DragOverlay>
                  {activeId && activeSlidePreview && (
                    <div className="w-[240px] opacity-80 pointer-events-none">
                       <SlideCard slide={activeSlidePreview} idx={slides.findIndex(s => s.id === activeId)} isSelected={selectedIds.has(activeId)} slideState={slideState} />
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          {item.kind === "song" ? (
            <>
              <ContextMenuItem onClick={() => handleAddSlide("VERSE")}>
                <PlusIcon className="mr-2 size-4" />
                <span>Add Verse</span>
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleAddSlide("CHORUS")}>
                <PlusIcon className="mr-2 size-4" />
                <span>Add Chorus</span>
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleAddSlide("BRIDGE")}>
                <PlusIcon className="mr-2 size-4" />
                <span>Add Bridge</span>
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem onClick={() => handleAddSlide("VERSE")}>
              <PlusIcon className="mr-2 size-4" />
              <span>Add Slide</span>
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem 
            onClick={handlePaste}
            disabled={clipboard.length === 0}
          >
            <span>Paste Slides</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

function SortableSlide({ 
  slide, 
  idx, 
  isSelected, 
  toggleSelect, 
  onDoubleClickSlide,
  onDelete,
  slideState
}: { 
  slide: any, 
  idx: number, 
  isSelected: boolean,
  toggleSelect: (id: string, multi: boolean, shift: boolean) => void,
  onDoubleClickSlide?: (id: string) => void,
  onDelete: () => void,
  slideState: any
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slide.id })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  }

  const { onContextMenu: _onContextMenu, ...restListeners } = listeners || {}

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <motion.div
            variants={itemVariants}
            {...restListeners}
            onContextMenu={(e) => {
              if (!isSelected) toggleSelect(slide.id, false, false)
            }}
            onClick={(e) => toggleSelect(slide.id, e.ctrlKey || e.metaKey, e.shiftKey)}
            onDoubleClick={() => onDoubleClickSlide?.(slide.id)}
            className={cn(
              "group relative flex flex-col text-left rounded-md border bg-card overflow-hidden transition-all hover:ring-2 hover:ring-sky-500/50 cursor-pointer select-none h-full",
              isSelected ? "ring-2 ring-sky-500 border-sky-500 shadow-[0_0_15px_rgba(14,165,233,0.3)]" : "border-border",
              isDragging && "opacity-0"
            )}
          >
            <SlideCard slide={slide} idx={idx} isSelected={isSelected} slideState={slideState} />
          </motion.div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem 
            onClick={(e) => {
              e.stopPropagation()
              if (!isSelected) toggleSelect(slide.id, false, false)
              onDelete()
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2Icon className="mr-2 size-4" />
            <span>Delete Slide</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  )
}

function SlideCard({ slide, idx, isSelected, slideState }: { slide: any, idx: number, isSelected: boolean, slideState: any }) {
  const baseTitle = slide.title.split(" ")[0]?.toLowerCase()
  const sType = songSectionType(baseTitle)

  return (
    <>
      {/* Colored Header Bar */}
      <div className={cn("px-3 py-1.5 flex items-center justify-between", sType.chip)}>
        <span className="text-[10px] font-bold uppercase tracking-wider text-foreground">
          {slide.title}
        </span>
        <span className="text-[9px] font-semibold text-muted-foreground/60 group-hover:text-foreground/40">
          {idx + 1}
        </span>
      </div>
      
      {/* Slide Content Preview */}
      <div 
        className="px-3 py-4 h-24 flex items-center"
        style={{ 
          background: slideState.bgType === "image" ? `url(${slideState.bgImage}) center/cover no-repeat` : slideState.bgColor 
        }}
      >
        <p 
          className="text-xs whitespace-pre-wrap leading-relaxed line-clamp-4"
          style={{ 
            color: slideState.boxes.find((b: any) => b.type === "content")?.color || "#ffffff",
            fontFamily: "Roboto"
          }}
        >
          {slide.content}
        </p>
      </div>
    </>
  )
}
