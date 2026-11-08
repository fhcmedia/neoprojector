import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckIcon, FilmIcon, SearchIcon } from "lucide-react"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { Medium } from "@/bindings/neoprojector/database"
import { Button } from "@/components/button"
import { Input } from "@/components/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog"
import { cn } from "@/lib/utils"
import { SlideMedia } from "./slide-thumb"

// LibraryPicker: choose pictures and videos from the Media library for a
// presentation. Click to select (a number shows the order they'll be
// added in), click again to unselect; "Add" appends them in that order.
export function LibraryPicker({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (mediaIds: number[]) => void
}) {
  const { data: media } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
  })
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<number[]>([])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (media ?? []).filter(
      (m) =>
        !m.hidden &&
        (m.type === "image" || m.type === "video") &&
        (!q || m.title.toLowerCase().includes(q) || m.original_filename.toLowerCase().includes(q))
    )
  }, [media, query])

  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const allShown = list.length > 0 && list.every((m) => picked.includes(m.id))

  function close(next: boolean) {
    if (!next) {
      setPicked([])
      setQuery("")
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[85vh] w-[min(900px,calc(95vw/var(--ui-zoom,1)))] max-w-none flex-col gap-3 sm:max-w-none">
        <DialogHeader>
          <DialogTitle>Add from library</DialogTitle>
          <DialogDescription>
            Pick pictures and videos — they're added in the order you click
            them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pictures and videos"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={list.length === 0}
            onClick={() =>
              setPicked((p) =>
                allShown
                  ? p.filter((id) => !list.some((m) => m.id === id))
                  : [...p, ...list.map((m) => m.id).filter((id) => !p.includes(id))]
              )
            }
          >
            {allShown ? "Unselect all" : "Select all"}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 ? (
            <div className="grid h-40 place-items-center text-xs text-muted-foreground/60">
              {media ? "No pictures or videos in the library yet — import some in the Media tab, or use “From computer”." : "Loading…"}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
              {list.map((m) => {
                const order = picked.indexOf(m.id)
                const on = order >= 0
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggle(m.id)}
                    className={cn(
                      "group flex flex-col overflow-hidden rounded border text-left transition-colors",
                      on ? "border-sky-400 ring-1 ring-sky-400" : "border-border/50 hover:border-border"
                    )}
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-black">
                      <SlideMedia mediaId={m.id} thumb />
                      {m.type === "video" && (
                        <FilmIcon className="absolute left-1.5 top-1.5 size-3.5 text-white/80 drop-shadow" />
                      )}
                      <span
                        className={cn(
                          "absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full border text-[10px] font-semibold",
                          on
                            ? "border-sky-400 bg-sky-500 text-white"
                            : "border-white/60 bg-black/40 text-transparent group-hover:text-white/70"
                        )}
                      >
                        {on ? order + 1 : <CheckIcon className="size-3" />}
                      </span>
                    </div>
                    <span className="truncate px-2 py-1 text-[11px] text-muted-foreground">
                      {m.title}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={picked.length === 0}
            onClick={() => {
              onAdd(picked)
              close(false)
            }}
          >
            Add {picked.length || ""} {picked.length === 1 ? "slide" : "slides"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
