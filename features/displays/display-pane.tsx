import { useEffect, useRef, useState, useMemo } from "react"
import {
  GripVerticalIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import type { Display } from "@/bindings/neoprojector/database"
import type { ScreenInfo } from "@/bindings/neoprojector/services/displays"
import { useTemplates } from "@/features/library/templates-api"
import {
  useDisplays,
  useCreateDisplay,
  useRenameDisplay,
  useDeleteDisplay,
  useSetDisplayEnabled,
  useSetDisplayBibleTemplate,
  useSetDisplaySongTemplate,
  useSetDisplayScreen,
  useReorderDisplays,
  useScreens,
} from "@/features/displays/api"
import { Input } from "@/components/input"
import { Switch } from "@/components/switch"
import { AddArea } from "@/components/add-area"
import { cn } from "@/lib/utils"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu"

// DisplaySettings: the full CRUD list. Rendered in the Settings >
// Display section. No surrounding pane chrome — the parent provides
// section header + scroll container.
export function DisplaySettings() {
  const { data: displays, isLoading } = useDisplays()
  const createMut = useCreateDisplay()
  const reorderMut = useReorderDisplays()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  )

  // First display defaults to "Audience" — the canonical name for the
  // main projector in this app's vocabulary. Subsequent displays just
  // increment, so a second/third monitor reads as "Display 2".
  function handleCreate() {
    const count = displays?.length ?? 0
    const name = count === 0 ? "Audience" : `Display ${count + 1}`
    createMut.mutate(name)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || !displays || active.id === over.id) return
    const oldIdx = displays.findIndex((d) => `display-${d.id}` === active.id)
    const newIdx = displays.findIndex((d) => `display-${d.id}` === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const next = [...displays]
    const [moved] = next.splice(oldIdx, 1)
    next.splice(newIdx, 0, moved)
    reorderMut.mutate(next.map((d) => d.id))
  }

  if (isLoading) {
    return (
      <div className="grid h-32 place-items-center text-xs text-muted-foreground/60">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-md border border-border/50 overflow-hidden">
      {displays && displays.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <VerticalSortable ids={displays.map((d) => `display-${d.id}`)}>
            {displays.map((d) => (
              <DisplayRow key={d.id} display={d} />
            ))}
          </VerticalSortable>
        </DndContext>
      )}
      <AddArea
        hasContent={!!displays && displays.length > 0}
        onClick={handleCreate}
        fullLabel="Add your first display"
        hoverLabel="Add display"
      />
    </div>
  )
}

function DisplayRow({ display }: { display: Display }) {
  const renameMut = useRenameDisplay()
  const deleteMut = useDeleteDisplay()
  const enabledMut = useSetDisplayEnabled()
  const { attributes, listeners, setNodeRef, style } = useSortableRow(
    `display-${display.id}`
  )

  const [editing, setEditing] = useState(false)
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

  const enabled = display.enabled !== 0

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
          "group flex flex-col gap-2 border-b border-border/40 px-2 py-3 text-xs transition-colors",
          pendingDelete
            ? "bg-destructive/15 text-foreground"
            : enabled
              ? "text-foreground"
              : "text-muted-foreground/60"
        )}
      >
        {/* Row 1: drag, switch, name, row-level actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag display"
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-50 hover:opacity-90"
          >
            <GripVerticalIcon className="size-3" />
          </button>

          <Switch
            checked={enabled}
            onCheckedChange={(v) =>
              enabledMut.mutate({ id: display.id, enabled: v })
            }
            aria-label={enabled ? "Disable display" : "Enable display"}
          />

          <div className="min-w-0 flex-1">
            {editing ? (
              <Input
                autoFocus
                defaultValue={display.name}
                onBlur={(e) => {
                  setEditing(false)
                  const v = e.target.value.trim()
                  if (v && v !== display.name)
                    renameMut.mutate({ id: display.id, name: v })
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur()
                  if (e.key === "Escape") setEditing(false)
                }}
                className="h-6 px-1.5 py-0 text-xs"
              />
            ) : (
              <span className="truncate font-medium">{display.name}</span>
            )}
          </div>

          <button
            type="button"
            aria-label="Rename"
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-amber-500/15 hover:text-amber-500 group-hover:opacity-70 hover:!opacity-100"
          >
            <PencilIcon className="size-3" />
          </button>
          <button
            type="button"
            aria-label={pendingDelete ? "Confirm delete" : "Delete"}
            onClick={(e) => {
              e.stopPropagation()
              if (pendingDelete) {
                deleteMut.mutate(display.id)
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
        </div>

        {/* Row 2: bindings — the per-display configuration that drives
            output behavior. Each pill is labelled so the user can tell
            at a glance which knob does what. */}
        <div className="flex flex-wrap items-center gap-2 pl-9">
          <ScreenDropdown
            displayId={display.id}
            currentScreenId={
              display.screen_id.Valid ? display.screen_id.String : null
            }
          />
          <BindingDropdown
            label="Bible template"
            kind="bible"
            currentId={
              display.bible_template_id.Valid
                ? display.bible_template_id.Int64
                : null
            }
            displayId={display.id}
          />
          <BindingDropdown
            label="Song template"
            kind="song"
            currentId={
              display.song_template_id.Valid
                ? display.song_template_id.Int64
                : null
            }
            displayId={display.id}
          />
        </div>
      </div>
    </div>
  )
}

// ScreenDropdown picks the physical monitor that this display's
// output window opens on. The OS screen id is opaque so we render
// the human label; a stored id that no longer matches any connected
// screen shows as "(disconnected)" — picking a new one re-binds.
function ScreenDropdown({
  displayId,
  currentScreenId,
}: {
  displayId: number
  currentScreenId: string | null
}) {
  const { data: screens } = useScreens()
  const setMut = useSetDisplayScreen()
  const list = screens ?? []
  const current = currentScreenId
    ? list.find((s) => s.id === currentScreenId)
    : null
  const stale = !!currentScreenId && !current
  const label = current
    ? screenLabel(current)
    : stale
      ? "(disconnected)"
      : "Unbound"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 min-w-[200px] shrink-0 items-center gap-1.5 rounded border border-border/50 px-2.5 text-[11px] transition-colors hover:bg-muted",
            current
              ? "text-foreground"
              : stale
                ? "text-destructive/80"
                : "text-muted-foreground/60"
          )}
        >
          <span className="text-muted-foreground/50">Monitor:</span>
          <span className="truncate">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="min-w-[220px]"
      >
        <DropdownMenuItem
          onSelect={() => setMut.mutate({ id: displayId, screenID: "" })}
          className={cn(currentScreenId === null && "font-medium")}
        >
          Unbound
        </DropdownMenuItem>
        {list.length > 0 && <DropdownMenuSeparator />}
        {list.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onSelect={() => setMut.mutate({ id: displayId, screenID: s.id })}
            className={cn(currentScreenId === s.id && "font-medium")}
          >
            <span className="flex-1 truncate">{screenLabel(s)}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              {s.width}×{s.height}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function screenLabel(s: ScreenInfo): string {
  const base = s.name || s.id
  return s.is_primary ? `${base} (primary)` : base
}

// BindingDropdown picks a template (filtered by kind) for one of the
// display's content kinds. Negative IDs come from frontend defaults;
// positive from DB rows. id = 0 means "no template bound".
function BindingDropdown({
  label,
  kind,
  currentId,
  displayId,
}: {
  label: string
  kind: "bible" | "song"
  currentId: number | null
  displayId: number
}) {
  const { data: templates } = useTemplates()
  const bibleMut = useSetDisplayBibleTemplate()
  const songMut = useSetDisplaySongTemplate()
  const mut = kind === "bible" ? bibleMut : songMut

  const filtered = useMemo(
    () => (templates ?? []).filter((t) => t.kind === kind),
    [templates, kind]
  )

  const current = useMemo(
    () =>
      currentId !== null ? filtered.find((t) => t.id === currentId) : undefined,
    [filtered, currentId]
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 min-w-[180px] shrink-0 items-center gap-1.5 rounded border border-border/50 px-2.5 text-[11px] transition-colors hover:bg-muted",
            current
              ? "text-foreground"
              : "text-muted-foreground/60"
          )}
        >
          <span className="text-muted-foreground/50">{label}:</span>
          <span className="truncate">{current?.name ?? "None"}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="min-w-[200px]">
        <DropdownMenuItem
          onSelect={() => mut.mutate({ id: displayId, templateID: 0 })}
          className={cn(currentId === null && "font-medium")}
        >
          None
        </DropdownMenuItem>
        {filtered.length > 0 && <DropdownMenuSeparator />}
        {filtered.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => mut.mutate({ id: displayId, templateID: t.id })}
            className={cn(currentId === t.id && "font-medium")}
          >
            <span className="truncate">{t.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
