import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ImageIcon,
  VideoIcon,
  FileAudioIcon,
  FileIcon,
  FileTextIcon,
  SearchIcon,
  UploadIcon,
} from "lucide-react"
import { Events } from "@wailsio/runtime"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import { Service as Schedule } from "@/bindings/neoprojector/services/schedule"
import type { Medium } from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"
import { cn } from "@/lib/utils"

const DROP_EVENT = "media:files-dropped"

type DropPayload = {
  paths?: string[]
  target_id?: string
  target_attrs?: Record<string, string>
}

export function MediaPicker({
  sectionId,
  onAdded,
}: {
  sectionId: number
  onAdded: () => void
}) {
  const qc = useQueryClient()
  const { data: media, isLoading } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
  })
  const [query, setQuery] = useState("")
  const [importing, setImporting] = useState(false)

  const filtered = useMemo(() => {
    if (!media) return []
    if (!query.trim()) return media
    const q = query.toLowerCase()
    return media.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.original_filename.toLowerCase().includes(q)
    )
  }, [media, query])

  async function importAndAdd(paths: string[]) {
    if (paths.length === 0) return
    setImporting(true)
    try {
      const created = (await Media.ImportFiles(
        paths
      )) as unknown as Medium[]
      // Add each new media as an item under the active section.
      for (const m of created) {
        await Schedule.AddMediaItem(sectionId, m.id)
      }
      qc.invalidateQueries({ queryKey: ["media", "list"] })
      qc.invalidateQueries({ queryKey: ["schedule", "items"] })
      onAdded()
    } finally {
      setImporting(false)
    }
  }

  // Listen for the bridged file-drop event from Go.
  useEffect(() => {
    const off = Events.On(DROP_EVENT, (event: { data?: DropPayload }) => {
      // Only act if the drop landed on our drop target (identified by id).
      const data = event?.data ?? {}
      if (data.target_id !== "media-drop-target") return
      const paths = data.paths ?? []
      if (paths.length === 0) return
      void importAndAdd(paths)
    })
    return () => {
      Events.Off(DROP_EVENT)
      void off
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId])

  function pick(mediaId: number) {
    void Schedule.AddMediaItem(sectionId, mediaId).then(() => {
      qc.invalidateQueries({ queryKey: ["schedule", "items"] })
      onAdded()
    })
  }

  return (
    <div className="flex h-full flex-col gap-2 pt-2">
      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search media… or drop files anywhere here to import"
          className="h-9 pl-8 text-sm placeholder:text-muted-foreground/40"
          autoFocus
        />
      </div>

      <DropTarget importing={importing}>
        {isLoading ? (
          <Empty>Loading…</Empty>
        ) : filtered.length === 0 ? (
          <Empty>
            {media && media.length === 0
              ? "Drop files here or below to add media."
              : "No matches."}
          </Empty>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 p-3">
            {filtered.map((m) => {
              const Icon = iconFor(m.type)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => pick(m.id)}
                  className="group flex flex-col gap-1 overflow-hidden rounded-md border border-border/50 bg-background/40 p-2 text-left transition-colors hover:border-border hover:bg-muted/40"
                >
                  <div className="flex aspect-video items-center justify-center rounded bg-foreground/5">
                    <Icon className="size-6 text-muted-foreground/70" />
                  </div>
                  <div className="truncate text-xs">{m.title}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                    {m.type}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </DropTarget>
    </div>
  )
}

// DropTarget wraps the library area. The `data-file-drop-target` attribute is
// the contract with Wails — when files are dragged over this element, Wails
// adds the `file-drop-target-active` class. We use that class to fade in the
// overlay below.
function DropTarget({
  importing,
  children,
}: {
  importing: boolean
  children: React.ReactNode
}) {
  return (
    <div
      id="media-drop-target"
      data-file-drop-target=""
      className={cn(
        "group relative flex-1 overflow-hidden rounded-md border border-border/50 bg-background/30",
        "[&.file-drop-target-active]:border-foreground/60 [&.file-drop-target-active]:bg-foreground/5"
      )}
    >
      <div className="h-full overflow-y-auto">{children}</div>
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/85 opacity-0 transition-opacity",
          // Overlay shows while a drop is hovering or while we're importing.
          "group-[.file-drop-target-active]:opacity-100",
          importing && "opacity-100"
        )}
      >
        <UploadIcon className="size-8 text-foreground/70" />
        <div className="text-sm font-medium text-foreground/80">
          {importing ? "Importing…" : "Drop to add to library"}
        </div>
      </div>
    </div>
  )
}

function iconFor(type: string) {
  switch (type) {
    case "image":
      return ImageIcon
    case "video":
      return VideoIcon
    case "audio":
      return FileAudioIcon
    case "pdf":
      return FileTextIcon
    default:
      return FileIcon
  }
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
      {children}
    </div>
  )
}
