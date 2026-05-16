import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSessionState } from "@/hooks/use-session-state"
import {
  ImageIcon,
  FilmIcon,
  FileAudioIcon,
  FileTextIcon,
  FileIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { Medium } from "@/bindings/neoprojector/database"
import { cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"

export type MediaKind = "all" | "image" | "video" | "audio" | "pdf"

type Props = {
  search: string
  kind?: MediaKind
  importing: boolean
  onImport: () => void | Promise<void>
  dropTarget: string
}

export function MediaTab({
  search,
  kind = "all",
  importing,
  onImport,
  dropTarget,
}: Props) {
  const { data: media, isLoading } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
  })
  const [selectedId, setSelectedId] = useSessionState<number | null>(
    "neoprojector.mediaSelectedId",
    null
  )

  const debounced = useDebounce(search, 200)

  const filtered = useMemo(() => {
    const list = media ?? []
    const needle = debounced.trim().toLowerCase()
    return list.filter((m) => {
      if (kind !== "all" && m.type !== kind) return false
      if (!needle) return true
      return (
        m.title.toLowerCase().includes(needle) ||
        m.original_filename.toLowerCase().includes(needle)
      )
    })
  }, [media, kind, debounced])

  return (
    <div className="flex h-full w-full flex-col">
      <div
        data-file-drop-target={dropTarget}
        className="relative min-h-0 flex-1 overflow-y-auto p-3"
      >
        {isLoading ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground/40">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <button
            type="button"
            onClick={() => void onImport()}
            className="grid h-full w-full place-items-center gap-2 rounded border border-dashed border-border/50 text-center text-xs text-muted-foreground/50 transition-colors hover:border-border hover:text-muted-foreground"
          >
            <UploadIcon className="size-6 opacity-60" />
            <div>
              {importing ? "Importing…" : "Drop files here or click to add media"}
            </div>
          </button>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {filtered.map((m) => {
              const isActive = m.id === selectedId
              const Icon = iconFor(m.type)
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedId(m.id)}
                  title={m.original_filename}
                  className={cn(
                    "group flex flex-col overflow-hidden rounded border text-left transition-colors",
                    isActive
                      ? "border-foreground/60 ring-1 ring-foreground/40"
                      : "border-border/50 hover:border-border"
                  )}
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-muted/40">
                    {m.type === "image" ? (
                      <img
                        src={`/media-asset/${m.id}`}
                        alt={m.title}
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : m.type === "video" ? (
                      <video
                        src={`/media-asset/${m.id}`}
                        className="absolute inset-0 h-full w-full object-cover"
                        preload="metadata"
                        muted
                      />
                    ) : (
                      <div className="grid h-full place-items-center text-muted-foreground/60">
                        <Icon className="size-6 opacity-70" />
                      </div>
                    )}
                  </div>
                  <div
                    className={cn(
                      "truncate border-t border-border/40 px-2 py-1 text-[11px]",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  >
                    {m.title}
                  </div>
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => void onImport()}
              disabled={importing}
              className="group flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded border border-dashed border-border/50 text-muted-foreground/40 transition-colors hover:border-border hover:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              <PlusIcon className="size-5" />
              <span className="text-[11px]">
                {importing ? "Importing…" : "Add media"}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function iconFor(type: string) {
  switch (type) {
    case "image":
      return ImageIcon
    case "video":
      return FilmIcon
    case "audio":
      return FileAudioIcon
    case "pdf":
      return FileTextIcon
    default:
      return FileIcon
  }
}
