import { useEffect, useRef, useState, useMemo } from "react"
import {
  GripVerticalIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
  MonitorIcon,
  MonitorOffIcon,
  ChevronDownIcon,
  BookOpenIcon,
  MusicIcon,
} from "lucide-react"
import type { Display, Template } from "@/bindings/neoprojector/database"
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
import { ScaledTemplate } from "@/features/templates/renderer"
import { sampleFor } from "@/features/templates/samples"
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/popover"

// templateName coerces a template's name to something safe to render.
// The DB column is TEXT and *should* always be a non-empty string, but
// a row saved with an empty/JSON-ish name would otherwise surface as a
// raw "{}" in the binding UI. Never render that — fall back to a label.
function templateName(t: { name?: unknown } | null | undefined): string {
  const n = t?.name
  if (typeof n === "string") {
    const trimmed = n.trim()
    if (trimmed && trimmed !== "{}" && trimmed !== "{ }") return trimmed
  }
  return "Untitled template"
}

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
    <div className="flex flex-col overflow-hidden rounded-lg border border-border/50">
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
  const { attributes, listeners, setNodeRef, style, isDragging } =
    useSortableRow(`display-${display.id}`)

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
      className={cn(isDragging && "relative z-10")}
    >
      <div
        className={cn(
          "group flex flex-col gap-3 border-b border-border/40 px-3 py-3 transition-colors last:border-b-0",
          pendingDelete
            ? "bg-destructive/10"
            : isDragging
              ? "bg-muted/40"
              : "hover:bg-muted/15"
        )}
      >
        {/* Header: drag, enable switch, name, row actions */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none grid size-6 shrink-0 place-items-center rounded text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <GripVerticalIcon className="size-3.5" />
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
                className="h-7 px-2 py-0 text-sm"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={cn(
                  "truncate text-left text-sm font-semibold tracking-tight",
                  enabled ? "text-foreground" : "text-muted-foreground/50"
                )}
              >
                {display.name}
              </button>
            )}
          </div>

          <button
            type="button"
            aria-label="Rename"
            onClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
            className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-amber-500/15 hover:text-amber-500 group-hover:opacity-70 hover:!opacity-100"
          >
            <PencilIcon className="size-3.5" />
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
              "grid size-6 shrink-0 place-items-center rounded transition-all",
              pendingDelete
                ? "bg-destructive text-destructive-foreground opacity-100"
                : "text-muted-foreground opacity-0 hover:bg-destructive/15 hover:text-destructive group-hover:opacity-70 hover:!opacity-100"
            )}
          >
            {pendingDelete ? (
              <XIcon className="size-3.5" />
            ) : (
              <Trash2Icon className="size-3.5" />
            )}
          </button>
        </div>

        {/* Bindings: the per-display config that drives output. Three
            equal cards that stretch across the available width — each
            template binding shows a live preview thumbnail so the
            operator recognizes it at a glance, not just by name. */}
        <div
          className={cn(
            "grid grid-cols-1 gap-2 pl-8 transition-opacity sm:grid-cols-2 lg:grid-cols-3",
            !enabled && "opacity-50"
          )}
        >
          <MonitorCard
            displayId={display.id}
            currentScreenId={
              display.screen_id.Valid ? display.screen_id.String : null
            }
          />
          <TemplateBindingCard
            label="Bible template"
            kind="bible"
            currentId={
              display.bible_template_id.Valid
                ? display.bible_template_id.Int64
                : null
            }
            displayId={display.id}
          />
          <TemplateBindingCard
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

// TemplateThumb renders a small 16:9 live preview of a template using
// kind-appropriate sample content (so a bible template previews with a
// verse, a song with lyrics). Null template → a dim kind glyph.
function TemplateThumb({
  template,
  kind,
  className,
}: {
  template: Template | null
  kind: "bible" | "song"
  className?: string
}) {
  const Icon = kind === "bible" ? BookOpenIcon : MusicIcon
  return (
    <div
      className={cn(
        "aspect-video shrink-0 overflow-hidden rounded border border-border/50 bg-black",
        className
      )}
    >
      {template ? (
        <ScaledTemplate
          template={template}
          fill={sampleFor(template.kind)}
          measure
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <div className="grid h-full place-items-center text-muted-foreground/30">
          <Icon className="size-4" />
        </div>
      )}
    </div>
  )
}

// MonitorCard binds the display to a physical screen. Same card shape
// as the template bindings (a 16:9 slot + label + value) so the row of
// three reads as a consistent set; the slot holds a monitor glyph
// since a screen has no template to preview.
function MonitorCard({
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-md border border-border/50 p-1.5 text-left transition-colors hover:border-border hover:bg-muted/30"
        >
          <div className="grid aspect-video w-20 shrink-0 place-items-center rounded border border-border/50 bg-muted/20 text-muted-foreground/40">
            {current ? (
              <MonitorIcon className="size-4" />
            ) : (
              <MonitorOffIcon className="size-4" />
            )}
          </div>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
              Monitor
            </span>
            <span
              className={cn(
                "truncate text-xs font-medium",
                current
                  ? "text-foreground"
                  : stale
                    ? "text-destructive/80"
                    : "text-muted-foreground/50"
              )}
            >
              {current
                ? screenLabel(current)
                : stale
                  ? "(disconnected)"
                  : "Unbound"}
            </span>
          </span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/40" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-[240px]">
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

// TemplateBindingCard picks a template (filtered by kind) for one of
// the display's content kinds, showing a live preview of the current
// pick. Clicking opens a popover grid of every template of that kind,
// each rendered as its own preview thumbnail — so choosing a template
// is a visual act, not a guess at a name. Negative ids are frontend
// defaults; id 0 clears the binding.
function TemplateBindingCard({
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
  const [open, setOpen] = useState(false)

  const filtered = useMemo(
    () => (templates ?? []).filter((t) => t.kind === kind),
    [templates, kind]
  )
  const current = useMemo(
    () =>
      currentId !== null ? filtered.find((t) => t.id === currentId) ?? null : null,
    [filtered, currentId]
  )

  function choose(templateID: number) {
    mut.mutate({ id: displayId, templateID })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-md border border-border/50 p-1.5 text-left transition-colors hover:border-border hover:bg-muted/30"
        >
          <TemplateThumb template={current} kind={kind} className="w-20" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
              {label}
            </span>
            <span
              className={cn(
                "truncate text-xs font-medium",
                current ? "text-foreground" : "text-muted-foreground/50"
              )}
            >
              {current ? templateName(current) : "None"}
            </span>
          </span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground/40" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-2"
      >
        <div className="mb-1.5 px-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/50">
          {label}
        </div>
        <div className="grid max-h-[340px] grid-cols-2 gap-1.5 overflow-y-auto">
          <button
            type="button"
            onClick={() => choose(0)}
            className={cn(
              "flex aspect-video items-center justify-center rounded border text-xs transition-colors",
              currentId === null
                ? "border-foreground/50 text-foreground"
                : "border-border/50 text-muted-foreground/60 hover:border-border hover:bg-muted/30"
            )}
          >
            None
          </button>
          {filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => choose(t.id)}
              className={cn(
                "group/opt flex flex-col overflow-hidden rounded border text-left transition-colors",
                currentId === t.id
                  ? "border-foreground/60 ring-1 ring-foreground/30"
                  : "border-border/50 hover:border-border"
              )}
            >
              <div className="aspect-video w-full bg-black">
                <ScaledTemplate
                  template={t}
                  fill={sampleFor(t.kind)}
                  measure
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
              <div className="truncate border-t border-border/40 px-1.5 py-1 text-[10px] font-medium">
                {templateName(t)}
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
