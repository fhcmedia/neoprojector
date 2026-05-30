import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowUpIcon,
  CopyIcon,
  LockIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { AddTile } from "@/features/library/add-tile"
import { useDebounce } from "@/hooks/use-debounce"
import { cn } from "@/lib/utils"
import {
  useOverlays,
  useCreateOverlay,
  useDeleteOverlay,
  buildCreateInputForKind,
  buildCreateInputFromOverlay,
} from "@/features/overlays/api"
import {
  isDefaultOverlayId,
} from "@/features/overlays/defaults"
import { WIDGETS, widgetDef } from "@/features/overlays/widgets"
import {
  parseConfig,
  parseLayouts,
  type WidgetKind,
} from "@/features/overlays/types"
import type { Overlay } from "@/bindings/neoprojector/database"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu"

type Props = {
  search: string
  onOpen: (overlay: Overlay) => void
  /** Append to the active service only (double-click). */
  onAddToService?: (overlay: Overlay) => void
  /** Append (if needed) and toggle on air. Requires an open service. */
  onGoLive?: (overlay: Overlay) => void
  serviceOpen?: boolean
}

// OverlaysTab — tile grid mirroring the Templates tab. Defaults are
// the locked rows up front (duplicate to edit); user-created overlays
// follow. A live preview tile renders the widget's actual output so
// the operator can spot the right one at a glance.
export function OverlaysTab({
  search,
  onOpen,
  onAddToService,
  onGoLive,
  serviceOpen = false,
}: Props) {
  const { data: overlays, isLoading } = useOverlays()
  const createMut = useCreateOverlay()
  const deleteMut = useDeleteOverlay()
  const debounced = useDebounce(search, 200)

  const filtered = useMemo(() => {
    const list = overlays ?? []
    const needle = debounced.trim().toLowerCase()
    if (!needle) return list
    return list.filter(
      (o) =>
        o.name.toLowerCase().includes(needle) ||
        o.kind.toLowerCase().includes(needle)
    )
  }, [overlays, debounced])

  if (isLoading) {
    return <Empty>Loading…</Empty>
  }

  return (
    <div className="h-full w-full overflow-y-auto p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        <AnimatePresence initial={false}>
          {filtered.map((o) => (
            <OverlayTile
              key={o.id}
              overlay={o}
              serviceOpen={serviceOpen}
              onEdit={() => onOpen(o)}
              onGoLive={onGoLive ? () => onGoLive(o) : undefined}
              onAddToService={
                onAddToService ? () => onAddToService(o) : undefined
              }
              onDuplicate={() =>
                createMut.mutate(buildCreateInputFromOverlay(o), {
                  onSuccess: onOpen,
                })
              }
              onDelete={() => deleteMut.mutate(o.id)}
            />
          ))}
        </AnimatePresence>
        <AddOverlayTile
          onPick={(kind) =>
            createMut.mutate(buildCreateInputForKind(kind), {
              onSuccess: onOpen,
            })
          }
        />
      </div>
      {filtered.length === 0 && (
        <Empty>
          {overlays && overlays.length === 0
            ? "No overlays yet — pick a widget to start."
            : "No matches."}
        </Empty>
      )}
    </div>
  )
}

function OverlayTile({
  overlay,
  serviceOpen,
  onEdit,
  onGoLive,
  onAddToService,
  onDuplicate,
  onDelete,
}: {
  overlay: Overlay
  serviceOpen: boolean
  onEdit: () => void
  onGoLive?: () => void
  onAddToService?: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const isDefault = isDefaultOverlayId(overlay.id)
  const [pendingDelete, setPendingDelete] = useState(false)
  const tileRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!pendingDelete) return
    function handler(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (tileRef.current?.contains(target)) return
      setPendingDelete(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [pendingDelete])

  const def = widgetDef(overlay.kind as WidgetKind)
  const config = parseConfig(overlay.config_json, def.defaultConfig)
  const layouts = parseLayouts(overlay.layouts_json, def.defaultLayout)
  const layout = layouts.default

  return (
    <motion.div
      ref={tileRef}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
      className="group flex flex-col overflow-hidden rounded border border-border/50 bg-background transition-colors hover:border-border"
    >
      <div
        className="relative aspect-video w-full bg-black"
        onDoubleClick={(e) => {
          if (!onAddToService) return
          e.preventDefault()
          onAddToService()
        }}
        title={
          onAddToService
            ? "Double-click to add to the active service"
            : undefined
        }
      >
        <div className="absolute inset-0">
          <div
            className="absolute"
            style={{
              left: `${(layout.x - layout.w / 2) * 100}%`,
              top: `${(layout.y - layout.h / 2) * 100}%`,
              width: `${layout.w * 100}%`,
              height: `${layout.h * 100}%`,
              containerType: "size",
            }}
          >
            <def.Renderer config={config} style={layout.style} />
          </div>
        </div>
        {isDefault && (
          <span
            aria-label="Default — duplicate to edit"
            title="Default — duplicate to edit"
            className="pointer-events-none absolute left-1.5 top-1.5 grid size-5 place-items-center rounded bg-background/70 text-muted-foreground backdrop-blur"
          >
            <LockIcon className="size-3" />
          </span>
        )}
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <TileIconAction
            ariaLabel="Go live"
            title={
              serviceOpen
                ? "Add to service and show on air"
                : "Open a service first"
            }
            disabled={!serviceOpen || !onGoLive}
            tone="live"
            onClick={onGoLive}
          >
            <ArrowUpIcon className="size-3.5" />
          </TileIconAction>
          <TileIconAction
            ariaLabel="Edit overlay"
            title="Edit overlay"
            tone="edit"
            onClick={onEdit}
          >
            <PencilIcon className="size-3.5" />
          </TileIconAction>
          <TileIconAction
            ariaLabel="Duplicate"
            title="Duplicate"
            tone="duplicate"
            onClick={onDuplicate}
          >
            <CopyIcon className="size-3.5" />
          </TileIconAction>
          {!isDefault && (
            <TileIconAction
              ariaLabel={pendingDelete ? "Confirm delete" : "Delete"}
              title={pendingDelete ? "Confirm delete" : "Delete"}
              tone={pendingDelete ? "danger" : "delete"}
              onClick={() => {
                if (pendingDelete) {
                  onDelete()
                  setPendingDelete(false)
                } else {
                  setPendingDelete(true)
                }
              }}
            >
              {pendingDelete ? (
                <XIcon className="size-3.5" />
              ) : (
                <Trash2Icon className="size-3.5" />
              )}
            </TileIconAction>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-0.5 border-t border-border/40 px-2 py-1.5">
        <span className="truncate text-[11px] font-medium text-foreground">
          {overlay.name}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
          {def.label}
        </span>
      </div>
    </motion.div>
  )
}

// AddOverlayTile: same dashed "+" shell as media / templates (via
// AddTile), but wrapped in a DropdownMenu so picking creates a fresh
// overlay seeded from the chosen widget's registry defaults. The
// trigger is `asChild` — the AddTile button IS the trigger.
type TileActionTone = "live" | "edit" | "duplicate" | "delete" | "danger"

const tileActionTone: Record<TileActionTone, string> = {
  live: "text-emerald-500 hover:bg-emerald-500/25 hover:text-emerald-400",
  edit: "text-muted-foreground hover:bg-amber-500/15 hover:text-amber-500",
  duplicate: "text-muted-foreground hover:bg-sky-500/30 hover:text-sky-500",
  delete: "text-muted-foreground hover:bg-destructive/30 hover:text-destructive",
  danger: "bg-destructive text-destructive-foreground",
}

function TileIconAction({
  ariaLabel,
  title,
  tone,
  disabled,
  onClick,
  children,
}: {
  ariaLabel: string
  title?: string
  tone: TileActionTone
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      className={cn(
        "grid size-6 cursor-pointer place-items-center rounded bg-background/70 backdrop-blur transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        tileActionTone[tone]
      )}
    >
      {children}
    </button>
  )
}

function AddOverlayTile({ onPick }: { onPick: (kind: WidgetKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <AddTile label="Add overlay" sublabel="New" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="min-w-[200px]">
        {Object.values(WIDGETS).map((w) => {
          const Icon = w.icon
          return (
            <DropdownMenuItem
              key={w.kind}
              onSelect={() => onPick(w.kind)}
              className="gap-2"
            >
              <Icon className="size-3.5" />
              <span>{w.label}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid place-items-center px-4 py-8 text-xs text-muted-foreground/40">
      {children}
    </div>
  )
}
