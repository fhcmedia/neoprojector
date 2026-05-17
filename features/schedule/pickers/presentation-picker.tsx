import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FilmIcon, SearchIcon } from "lucide-react"
import { Service as Schedule } from "@/bindings/neoprojector/services/schedule"
import type { ServiceItem } from "@/bindings/neoprojector/database"
import { motion } from "motion/react"
import { Input } from "@/components/input"
import { usePresentations } from "@/features/presentations/api"
import { cn } from "@/lib/utils"
import {
  pickerContainerVariants,
  pickerRowVariants,
} from "@/features/schedule/picker-anim"

// PresentationPicker — pick an existing presentation and link it to
// the section as a "presentation" schedule item. The presentation
// itself is authored in the Library → Presentations editor; this
// picker is just the binding step.
export function PresentationPicker({
  sectionId,
  onAdded,
}: {
  sectionId: number
  onAdded: (newItemId?: number) => void
}) {
  const qc = useQueryClient()
  const { data: presentations, isLoading } = usePresentations()
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    if (!presentations) return []
    if (!query.trim()) return presentations
    const q = query.toLowerCase()
    return presentations.filter((p) => p.name.toLowerCase().includes(q))
  }, [presentations, query])

  const addMut = useMutation({
    mutationFn: (presentationId: number) =>
      Schedule.AddPresentationItem(
        sectionId,
        presentationId
      ) as unknown as Promise<ServiceItem>,
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ["schedule", "items"] })
      onAdded(item?.id)
    },
  })

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search presentations"
          className="h-7 pl-7 text-xs"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border/40">
        {isLoading ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground/40">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center text-xs text-muted-foreground/40">
            {presentations && presentations.length === 0
              ? "No presentations. Create one in the Library → Presentations tab."
              : "No matches."}
          </div>
        ) : (
          <motion.ul
            variants={pickerContainerVariants}
            initial="hidden"
            animate="visible"
            className="flex flex-col"
          >
            {filtered.map((p) => (
              <motion.li
                key={p.id}
                variants={pickerRowVariants}
              >
                <button
                  type="button"
                  onClick={() => addMut.mutate(p.id)}
                  disabled={addMut.isPending}
                  className={cn(
                    "flex w-full items-center gap-2 border-b border-border/30 px-2 py-1.5 text-left text-xs transition-colors",
                    "hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  <FilmIcon className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{p.name}</span>
                </button>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </div>
    </div>
  )
}
