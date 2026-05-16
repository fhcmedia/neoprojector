import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { useQueryClient } from "@tanstack/react-query"
import { FileTextIcon, Trash2Icon, PencilIcon, XIcon } from "lucide-react"
import { AddArea } from "@/components/add-area"
import { Input } from "@/components/input"
import { cn } from "@/lib/utils"
import {
  scheduleKeys,
  useServices,
  useCreateService,
  useRenameService,
  useDeleteService,
} from "@/features/schedule/api"
import { Service as Schedule } from "@/bindings/neoprojector/services/schedule"
import type {
  Service,
  ServiceSection,
} from "@/bindings/neoprojector/database"
import {
  resolveServiceName,
  useServiceNameFormat,
} from "@/hooks/use-service-name-format"

type Props = {
  activeServiceId: number | undefined
  lastActiveServiceId: number | undefined
  onSelect: (id: number) => void
}

export function ServiceList({
  activeServiceId,
  lastActiveServiceId,
  onSelect,
}: Props) {
  const { data: services, isLoading } = useServices()
  const createMut = useCreateService()
  const renameMut = useRenameService()
  const deleteMut = useDeleteService()
  const { format } = useServiceNameFormat()

  const [editingId, setEditingId] = useState<number | null>(null)
  // Hide the freshly-created service from this list until the parent's
  // slide-out has settled. Otherwise the query-cache invalidation lands
  // mid-transition and the new row visibly pops into the fading list.
  const [hiddenServiceId, setHiddenServiceId] = useState<number | null>(null)
  const hiddenTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (hiddenTimerRef.current !== null) {
        window.clearTimeout(hiddenTimerRef.current)
      }
    }
  }, [])

  function handleCreate() {
    const name = resolveServiceName(format)
    createMut.mutate(name, {
      onSuccess: (created) => {
        setHiddenServiceId(created.id)
        if (hiddenTimerRef.current !== null) {
          window.clearTimeout(hiddenTimerRef.current)
        }
        hiddenTimerRef.current = window.setTimeout(() => {
          setHiddenServiceId(null)
          hiddenTimerRef.current = null
        }, 350)
        onSelect(created.id)
      },
    })
  }

  function handleRename(id: number, name: string) {
    setEditingId(null)
    if (!name.trim()) return
    renameMut.mutate({ id, name: name.trim() })
  }

  const visibleServices = services?.filter(
    (s) => s.id !== hiddenServiceId
  )
  const hasServices = !!visibleServices && visibleServices.length > 0

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-7 items-center border-b border-border/50 px-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Schedule
        </span>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-2 text-xs text-muted-foreground/60">
            Loading…
          </div>
        ) : (
          <>
            {hasServices && (
              <AnimatePresence initial={false}>
                {visibleServices!.map((svc) => (
                  <ServiceRow
                    key={svc.id}
                    service={svc}
                    isActive={svc.id === activeServiceId}
                    isLastActive={
                      svc.id === lastActiveServiceId &&
                      svc.id !== activeServiceId
                    }
                    isEditing={svc.id === editingId}
                    onSelect={() => onSelect(svc.id)}
                    onStartEdit={() => setEditingId(svc.id)}
                    onRename={(name) => handleRename(svc.id, name)}
                    onCancelEdit={() => setEditingId(null)}
                    onDelete={() => {
                      deleteMut.mutate(svc.id)
                      if (svc.id === activeServiceId) onSelect(0)
                    }}
                  />
                ))}
              </AnimatePresence>
            )}
            <AddArea
              hasContent={hasServices}
              onClick={handleCreate}
              fullLabel="Click to create your first service"
              hoverLabel="Add new service"
            />
          </>
        )}
      </div>
    </div>
  )
}

function ServiceRow({
  service,
  isActive,
  isLastActive,
  isEditing,
  onSelect,
  onStartEdit,
  onRename,
  onCancelEdit,
  onDelete,
}: {
  service: Service
  isActive: boolean
  isLastActive: boolean
  isEditing: boolean
  onSelect: () => void
  onStartEdit: () => void
  onRename: (name: string) => void
  onCancelEdit: () => void
  onDelete: () => void
}) {
  const qc = useQueryClient()
  const [pendingDelete, setPendingDelete] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)

  // Skip the confirm step when the service has zero sections — no risk of
  // losing user content. Pulled via fetchQuery so the cache is consulted
  // first; the underlying call is local Wails IPC so the worst case is a
  // sub-frame round-trip rather than a network hop.
  async function handleDeleteClick() {
    let isEmpty = false
    try {
      const sections = await qc.fetchQuery<ServiceSection[]>({
        queryKey: scheduleKeys.sections(service.id),
        queryFn: () =>
          Schedule.ListSections(service.id) as unknown as Promise<
            ServiceSection[]
          >,
      })
      isEmpty = !sections || sections.length === 0
    } catch {
      // If sections can't be loaded, fall through to the confirm flow —
      // better to ask than to silently delete potentially full data.
      isEmpty = false
    }
    if (isEmpty) {
      onDelete()
      setPendingDelete(false)
      return
    }
    if (pendingDelete) {
      onDelete()
      setPendingDelete(false)
    } else {
      setPendingDelete(true)
    }
  }

  // Click anywhere outside this row cancels the pending-delete confirm.
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

  return (
    <motion.div
      ref={rowRef}
      initial={false}
      exit={{ height: 0, opacity: 0 }}
      transition={{
        height: { duration: 0.14, ease: [0.32, 0.72, 0, 1] },
        opacity: { duration: 0.09 },
      }}
      className="overflow-hidden"
    >
      <div
        className={cn(
          "group relative flex w-full items-center gap-2 border-b border-border/40 px-3 py-1.5 text-left text-xs transition-colors",
          pendingDelete && "bg-destructive/15 text-foreground",
          !pendingDelete && isActive && "bg-muted text-foreground",
          !pendingDelete &&
            !isActive &&
            "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        )}
      >
        <button
          type="button"
          onClick={() => !isEditing && onSelect()}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <FileTextIcon
            className={cn(
              "size-3.5 shrink-0 opacity-70",
              isLastActive && !pendingDelete && "text-emerald-500 opacity-100"
            )}
          />
          {isEditing ? (
            <Input
              autoFocus
              defaultValue={service.name}
              onBlur={(e) => onRename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename(e.currentTarget.value)
                else if (e.key === "Escape") onCancelEdit()
              }}
              className="h-6 px-1.5 py-0 text-xs"
            />
          ) : (
            <span
              className={cn(
                "truncate",
                // Last-active breadcrumb: just colour the label emerald
                // (and its leading icon above). No gradient overlay so
                // the row keeps the same visual width as the rest.
                isLastActive &&
                  !pendingDelete &&
                  "font-medium text-emerald-500"
              )}
            >
              {service.name}
            </span>
          )}
        </button>
        {!isEditing && (
          <div className="relative z-[1] flex items-center gap-1">
            <button
              type="button"
              aria-label="Rename"
              onClick={(e) => {
                e.stopPropagation()
                onStartEdit()
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
                void handleDeleteClick()
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
        )}
      </div>
    </motion.div>
  )
}
