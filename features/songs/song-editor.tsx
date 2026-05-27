import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import {
  ChevronDownIcon,
  CopyIcon,
  GripVerticalIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import { arrayMove } from "@dnd-kit/sortable"

import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import { SongSpec } from "@/bindings/neoprojector/services/songs"
import type { SongFull } from "@/bindings/neoprojector/services/songs"
import type { Song } from "@/bindings/neoprojector/database"
import { pushSong } from "@/lib/library-sync"
import { Input } from "@/components/input"
import { Textarea } from "@/components/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu"
import { cn } from "@/lib/utils"
import { songSectionType, songSectionTypes } from "@/features/songs/section-types"
import {
  pickerContainerVariants,
  pickerRowVariants,
} from "@/features/schedule/picker-anim"
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

type LocalSection = {
  localId: number
  type: string
  text: string
}

type Props =
  | {
      mode: "create"
      onSaved: (songId: number) => void
      onCancel: () => void
    }
  | {
      mode: "edit"
      songId: number
      onSaved: () => void
      onCancel?: () => void
    }

// SongEditor live-saves on every change. In create mode it persists the
// row the moment a section has any text — the user never has to "save."
// Once persisted, subsequent edits flow through Update silently. After the
// first create, onSaved fires exactly once so a parent (e.g. the schedule
// add flow) can attach the new song id to its own structure.
export function SongEditor(props: Props) {
  const isEdit = props.mode === "edit"
  const editingSongId = props.mode === "edit" ? props.songId : undefined
  const qc = useQueryClient()

  const [title, setTitle] = useState("")
  const [sections, setSections] = useState<LocalSection[]>([])
  // localSongId tracks the row this editor is bound to. Starts as the
  // edit-mode id, gets set after a create-mode auto-save completes.
  //
  // localSongIdRef mirrors the state so the in-flight flush loop reads
  // the just-created id synchronously. Without it, a flush that loops
  // again (because another snapshot landed during await) would re-enter
  // the create branch and duplicate the row.
  const [localSongId, setLocalSongId] = useState<number | undefined>(
    editingSongId
  )
  const localSongIdRef = useRef<number | undefined>(editingSongId)
  const nextId = useRef(1)

  const { data: existing, isLoading } = useQuery({
    queryKey: ["songs", "full", editingSongId],
    queryFn: () =>
      Songs.GetSong(editingSongId!) as unknown as Promise<SongFull>,
    enabled: !!editingSongId,
  })

  const populatedRef = useRef(false)
  useEffect(() => {
    if (!isEdit || !existing || populatedRef.current) return
    populatedRef.current = true
    setTitle(existing.song.title)
    const localSections: LocalSection[] = existing.sections.map((s) => ({
      localId: nextId.current++,
      type: s.section.type,
      text: s.lines.map((l) => l.text).join("\n"),
    }))
    setSections(localSections)
  }, [existing, isEdit])

  // Dirty becomes true the first time the user changes anything. Without
  // it the sync effect would fire on initial mount (or right after edit-
  // mode population) and re-persist unchanged content.
  const dirtyRef = useRef(false)
  const markDirty = () => {
    dirtyRef.current = true
  }

  function handleAddSection(type: string) {
    markDirty()
    setSections((prev) => [
      ...prev,
      { localId: nextId.current++, type, text: "" },
    ])
  }

  function handleChangeType(localId: number, type: string) {
    markDirty()
    setSections((prev) =>
      prev.map((s) => (s.localId === localId ? { ...s, type } : s))
    )
  }

  function handleChangeText(localId: number, text: string) {
    markDirty()
    setSections((prev) =>
      prev.map((s) => (s.localId === localId ? { ...s, text } : s))
    )
  }

  function handleDeleteSection(localId: number) {
    markDirty()
    setSections((prev) => prev.filter((s) => s.localId !== localId))
  }

  function handleDuplicateSection(localId: number) {
    markDirty()
    setSections((prev) => {
      const idx = prev.findIndex((s) => s.localId === localId)
      if (idx < 0) return prev
      const source = prev[idx]
      const copy: LocalSection = {
        localId: nextId.current++,
        type: source.type,
        text: source.text,
      }
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)]
    })
  }

  function handleReorderSections(fromId: number, toId: number) {
    if (fromId === toId) return
    markDirty()
    setSections((prev) => {
      const oldIdx = prev.findIndex((s) => s.localId === fromId)
      const newIdx = prev.findIndex((s) => s.localId === toId)
      if (oldIdx < 0 || newIdx < 0) return prev
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  function handleChangeTitle(value: string) {
    markDirty()
    setTitle(value)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const activeId = Number(String(active.id).replace(/^song-section-/, ""))
    const overId = Number(String(over.id).replace(/^song-section-/, ""))
    handleReorderSections(activeId, overId)
  }

  // Single-snapshot write queue: at most one in-flight save; the latest
  // snapshot always wins. No debounce — the user wanted every change to
  // land, and the queue prevents stale writes from racing each other.
  const pendingRef = useRef<{ title: string; sections: LocalSection[] } | null>(
    null
  )
  const inFlightRef = useRef(false)
  const onSavedFiredRef = useRef(false)

  async function flush() {
    if (inFlightRef.current) return
    while (pendingRef.current) {
      const snapshot = pendingRef.current
      pendingRef.current = null
      inFlightRef.current = true
      try {
        const spec = new SongSpec({
          title: snapshot.title.trim() || "Untitled",
          sections: snapshot.sections.map((s) => ({
            type: s.type,
            text: s.text,
          })),
        })

        const boundId = localSongIdRef.current
        if (boundId !== undefined) {
          await Songs.UpdateSongFromSpec(boundId, spec)
        } else {
          // Create mode: hold the write until at least one section has
          // text. Title alone (or empty editor) is not enough — that
          // would litter the library with empty rows on any stray click.
          const hasContent = snapshot.sections.some((s) => s.text.trim())
          if (!hasContent) {
            inFlightRef.current = false
            continue
          }
          const created = (await Songs.CreateSongFromSpec(
            spec
          )) as unknown as Song
          // Set the ref first so the next loop iteration sees the new
          // id; the state update is for re-render only.
          localSongIdRef.current = created.id
          setLocalSongId(created.id)
          if (!onSavedFiredRef.current && props.mode === "create") {
            onSavedFiredRef.current = true
            props.onSaved(created.id)
          }
        }
        const savedId = localSongIdRef.current
        qc.invalidateQueries({ queryKey: ["songs", "list"] })
        if (savedId !== undefined) {
          qc.invalidateQueries({ queryKey: ["songs", "full", savedId] })
        }
        qc.invalidateQueries({ queryKey: ["schedule", "items"] })

        // Phase-1 cloud sync. Fire-and-forget — the local write already
        // succeeded; a failed push is non-fatal and gets retried next time
        // the user touches the song. We refresh the cloud-library queries
        // after a successful push so the dashboard tab in the desktop app
        // (and the website on next visit) sees the new count immediately.
        if (savedId !== undefined) {
          void (async () => {
            try {
              const full = (await Songs.GetSong(savedId)) as unknown as SongFull
              const result = await pushSong(full)
              if (result.ok) {
                qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
              }
            } catch (err) {
              console.warn("[song-editor] cloud sync skipped", err)
            }
          })()
        }
      } catch (err) {
        console.error(err)
      }
      inFlightRef.current = false
    }
  }

  useEffect(() => {
    if (!dirtyRef.current) return
    pendingRef.current = { title, sections }
    void flush()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, sections])

  // Pull the library for live duplicate-title detection. Shares the cache
  // key with consumers so no extra fetch occurs.
  const { data: librarySongs } = useQuery({
    queryKey: ["songs", "list"],
    queryFn: () => Songs.ListSongs() as unknown as Promise<Song[]>,
  })

  const titleConflict = useMemo(() => {
    const trimmed = title.trim()
    if (!trimmed || !librarySongs) return false
    const lower = trimmed.toLowerCase()
    return librarySongs.some(
      (s) => s.title.toLowerCase() === lower && s.id !== localSongId
    )
  }, [title, librarySongs, localSongId])

  if (isEdit && isLoading) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
        Loading…
      </div>
    )
  }

  return (
    <motion.div
      className="flex h-full flex-col"
      variants={pickerContainerVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
    >
      <motion.div variants={pickerRowVariants}>
        <Input
          autoFocus={!isEdit}
          value={title}
          onChange={(e) => handleChangeTitle(e.target.value)}
          placeholder="Song title"
          title={titleConflict ? "Another song already uses this title" : undefined}
          className={cn(
            "h-7 rounded-none border-0 border-b border-border/50 bg-transparent px-3 text-xs font-medium tracking-tight shadow-none focus-visible:ring-0",
            titleConflict && "border-b-destructive text-destructive"
          )}
        />
      </motion.div>

      <motion.div
        variants={pickerRowVariants}
        className="flex flex-1 flex-col overflow-y-auto"
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <VerticalSortable
            ids={sections.map((s) => `song-section-${s.localId}`)}
          >
            {sections.map((sec, i) => {
              // 1-indexed count of preceding sections of the same type,
              // including the current one. Drives "Verse 1", "Verse 2", …
              // labels so the user never types numbers themselves.
              let number = 0
              for (let j = 0; j <= i; j++) {
                if (sections[j].type === sec.type) number++
              }
              return (
                <SectionBlock
                  key={sec.localId}
                  section={sec}
                  number={number}
                  empty={!sec.text.trim()}
                  onChangeType={(t) => handleChangeType(sec.localId, t)}
                  onChangeText={(t) => handleChangeText(sec.localId, t)}
                  onDelete={() => handleDeleteSection(sec.localId)}
                  onDuplicate={() => handleDuplicateSection(sec.localId)}
                />
              )
            })}
          </VerticalSortable>
        </DndContext>
        <InsertSection
          empty={sections.length === 0}
          onPick={handleAddSection}
        />
      </motion.div>
    </motion.div>
  )
}

const chooserContainerVariants = {
  open: {
    transition: { staggerChildren: 0.04, staggerDirection: 1 },
  },
  closed: {
    transition: { staggerChildren: 0.04, staggerDirection: -1 },
  },
}

const chooserRowVariants = {
  open: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 500, damping: 30 },
  },
  closed: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.14 },
  },
}

function InsertSection({
  empty,
  onPick,
}: {
  empty: boolean
  onPick: (type: string) => void
}) {
  const [choosing, setChoosing] = useState(false)

  function pick(type: string) {
    onPick(type)
    setChoosing(false)
  }

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {choosing ? (
        <motion.div
          key="chooser"
          className="flex flex-1 flex-col"
          variants={chooserContainerVariants}
          initial="closed"
          animate="open"
          exit="closed"
        >
          {songSectionTypes.map((t) => (
            <motion.button
              key={t.key}
              type="button"
              onClick={() => pick(t.key)}
              variants={chooserRowVariants}
              className={cn(
                "flex flex-1 items-center gap-1.5 border-b border-l-2 border-b-border/40 pl-2.5 pr-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                t.border
              )}
              style={{ minHeight: "2.25rem" }}
            >
              {t.label}
            </motion.button>
          ))}
          <motion.button
            type="button"
            onClick={() => setChoosing(false)}
            variants={chooserRowVariants}
            className="flex shrink-0 items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] text-muted-foreground/70 transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <XIcon className="size-3" />
            Cancel
          </motion.button>
        </motion.div>
      ) : (
        <motion.button
          key="prompt"
          type="button"
          onClick={() => setChoosing(true)}
          aria-label={empty ? "Add your first section" : "Add section"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className={cn(
            "group flex flex-1 items-center justify-center gap-1.5 text-xs transition-colors",
            empty
              ? "min-h-full text-muted-foreground/70 hover:text-muted-foreground"
              : "min-h-16 text-muted-foreground/0 hover:text-muted-foreground/60"
          )}
        >
          <PlusIcon
            className={cn(
              "size-3.5 transition-opacity",
              !empty && "opacity-0 group-hover:opacity-100"
            )}
          />
          <span
            className={cn(
              "transition-opacity",
              !empty && "opacity-0 group-hover:opacity-100"
            )}
          >
            {empty ? "Add your first section" : "Add section"}
          </span>
        </motion.button>
      )}
    </AnimatePresence>
  )
}

function SectionBlock({
  section,
  number,
  empty,
  onChangeType,
  onChangeText,
  onDelete,
  onDuplicate,
}: {
  section: LocalSection
  number: number
  empty: boolean
  onChangeType: (type: string) => void
  onChangeText: (text: string) => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const type = songSectionType(section.type)
  const { attributes, listeners, setNodeRef, style } = useSortableRow(
    `song-section-${section.localId}`,
    { type: "song-section" }
  )

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={cn(
          "group/section flex flex-col border-b border-l-2 border-b-border/40",
          type.border
        )}
      >
        <div className="flex items-center gap-1 pl-1.5 pr-1.5 py-1.5 text-muted-foreground/80">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag section"
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover/section:opacity-50 hover:opacity-90"
          >
            <GripVerticalIcon className="size-3" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none"
              >
                {type.label} {number}
                <ChevronDownIcon className="size-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6}>
              {songSectionTypes.map((t) => (
                <DropdownMenuItem
                  key={t.key}
                  onSelect={() => onChangeType(t.key)}
                >
                  <span className={cn("size-2.5 rounded-full", t.swatch)} />
                  {t.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onDuplicate}
              aria-label="Duplicate section"
              className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-sky-500/15 hover:text-sky-500 group-hover/section:opacity-70 hover:!opacity-100"
            >
              <CopyIcon className="size-3" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete section"
              className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover/section:opacity-70 hover:!opacity-100"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        </div>
        <div className="flex-1 pl-2">
          <Textarea
            value={section.text}
            onChange={(e) => onChangeText(e.target.value)}
            placeholder="One line per line…"
            className={cn(
              "h-full w-full resize-none rounded-none border-0 bg-transparent px-3 py-2 text-xs leading-relaxed text-foreground/90 shadow-none focus-visible:ring-0 dark:bg-transparent",
              empty ? "min-h-16" : "min-h-12"
            )}
          />
        </div>
      </div>
    </div>
  )
}

