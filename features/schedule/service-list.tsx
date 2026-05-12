import { useState } from "react"
import { PlusIcon, FileTextIcon, Trash2Icon, PencilIcon } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
  useServices,
  useCreateService,
  useRenameService,
  useDeleteService,
} from "./api"

type Props = {
  activeServiceId: number | undefined
  onSelect: (id: number) => void
}

export function ServiceList({ activeServiceId, onSelect }: Props) {
  const { data: services, isLoading } = useServices()
  const createMut = useCreateService()
  const renameMut = useRenameService()
  const deleteMut = useDeleteService()

  const [editingId, setEditingId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

  function handleCreate() {
    createMut.mutate("", {
      onSuccess: (created) => {
        onSelect(created.id)
        setEditingId(created.id)
      },
    })
  }

  function handleRename(id: number, name: string) {
    setEditingId(null)
    if (!name.trim()) return
    renameMut.mutate({ id, name: name.trim() })
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-7 items-center justify-between border-b border-border/50 px-3">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Schedule
        </span>
        <button
          type="button"
          aria-label="New service"
          onClick={handleCreate}
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
        ) : !services || services.length === 0 ? (
          <div className="px-3 py-3 text-xs text-muted-foreground/60">
            No services yet. Click + to create one.
          </div>
        ) : (
          services.map((svc) => {
            const isActive = svc.id === activeServiceId
            const isEditing = svc.id === editingId
            return (
              <ContextMenu key={svc.id}>
                <ContextMenuTrigger asChild>
                  <button
                    type="button"
                    onClick={() => !isEditing && onSelect(svc.id)}
                    onDoubleClick={() => setEditingId(svc.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                      isActive
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <FileTextIcon className="size-3.5 shrink-0 opacity-70" />
                    {isEditing ? (
                      <Input
                        autoFocus
                        defaultValue={svc.name}
                        onBlur={(e) => handleRename(svc.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleRename(svc.id, e.currentTarget.value)
                          } else if (e.key === "Escape") {
                            setEditingId(null)
                          }
                        }}
                        className="h-6 px-1.5 py-0 text-xs"
                      />
                    ) : (
                      <span className="truncate">{svc.name}</span>
                    )}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => setEditingId(svc.id)}>
                    <PencilIcon className="size-3.5" />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => setConfirmDeleteId(svc.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            )
          })
        )}
      </div>

      <AlertDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete service?</AlertDialogTitle>
            <AlertDialogDescription>
              The service and all its sections and items will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmDeleteId !== null) {
                  deleteMut.mutate(confirmDeleteId)
                  if (confirmDeleteId === activeServiceId) {
                    onSelect(0)
                  }
                }
                setConfirmDeleteId(null)
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
