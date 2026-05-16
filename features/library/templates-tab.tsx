import { useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  CopyIcon,
  LockIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"
import {
  useCreateTemplate,
  useDeleteTemplate,
  useDuplicateTemplate,
  useTemplates,
} from "@/features/library/templates-api"
import { ScaledTemplate } from "@/features/templates/renderer"
import { sampleFor } from "@/features/templates/samples"
import { isDefaultTemplateId } from "@/features/templates/defaults"
import type { Template } from "@/bindings/neoprojector/database"

type Props = {
  search: string
  onOpen: (template: Template) => void
}

export function TemplatesTab({ search, onOpen }: Props) {
  const { data: templates, isLoading } = useTemplates()
  const dupMut = useDuplicateTemplate()
  const createMut = useCreateTemplate()
  const delMut = useDeleteTemplate()

  const debounced = useDebounce(search, 200)
  const filtered = useMemo(() => {
    const list = templates ?? []
    const needle = debounced.trim().toLowerCase()
    if (!needle) return list
    return list.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        t.kind.toLowerCase().includes(needle)
    )
  }, [templates, debounced])

  if (isLoading) {
    return <Empty>Loading…</Empty>
  }
  if (filtered.length === 0) {
    return (
      <Empty>
        {templates && templates.length === 0
          ? "No templates yet."
          : "No matches."}
      </Empty>
    )
  }

  return (
    <div className="h-full w-full overflow-y-auto p-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        <AnimatePresence initial={false}>
          {filtered.map((t) => (
            <TemplateTile
              key={t.id}
              template={t}
              onOpen={() => onOpen(t)}
              onDuplicate={() => {
                // Defaults aren't in the DB — duplicating one means
                // posting its body as a fresh user template.
                if (isDefaultTemplateId(t.id)) {
                  createMut.mutate(
                    {
                      name: `${t.name} copy`,
                      kind: t.kind,
                      viewportW: t.viewport_w,
                      viewportH: t.viewport_h,
                      dataJSON: t.data_json,
                    },
                    { onSuccess: (copy) => onOpen(copy) }
                  )
                } else {
                  dupMut.mutate(t.id, {
                    onSuccess: (copy) => onOpen(copy),
                  })
                }
              }}
              onDelete={() => delMut.mutate(t.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function TemplateTile({
  template,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  template: Template
  onOpen: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const isDefault = isDefaultTemplateId(template.id)
  const [pendingDelete, setPendingDelete] = useState(false)
  const sample = sampleFor(template.kind)
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
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-video w-full bg-muted/40 text-left"
      >
        <ScaledTemplate
          template={template}
          fill={sample}
          measure
          style={{ width: "100%", height: "100%" }}
        />
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
          <span
            role="button"
            aria-label="Duplicate"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                e.stopPropagation()
                onDuplicate()
              }
            }}
            className="grid size-6 cursor-pointer place-items-center rounded bg-background/70 text-muted-foreground backdrop-blur transition-colors hover:bg-sky-500/30 hover:text-sky-500"
          >
            <CopyIcon className="size-3.5" />
          </span>
          {!isDefault && (
            <span
              role="button"
              aria-label={pendingDelete ? "Confirm delete" : "Delete"}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                if (pendingDelete) {
                  onDelete()
                  setPendingDelete(false)
                } else {
                  setPendingDelete(true)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  e.stopPropagation()
                  if (pendingDelete) {
                    onDelete()
                    setPendingDelete(false)
                  } else {
                    setPendingDelete(true)
                  }
                }
              }}
              className={cn(
                "grid size-6 cursor-pointer place-items-center rounded transition-colors",
                pendingDelete
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-background/70 text-muted-foreground backdrop-blur hover:bg-destructive/30 hover:text-destructive"
              )}
            >
              {pendingDelete ? (
                <XIcon className="size-3.5" />
              ) : (
                <Trash2Icon className="size-3.5" />
              )}
            </span>
          )}
        </div>
      </button>
      <div className="flex flex-col gap-0.5 border-t border-border/40 px-2 py-1.5">
        <span className="truncate text-[11px] font-medium text-foreground">
          {template.name}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
          {template.kind}
        </span>
      </div>
    </motion.div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center text-xs text-muted-foreground/40">
      {children}
    </div>
  )
}
