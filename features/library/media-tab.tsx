import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  SearchIcon,
  ImageIcon,
  FilmIcon,
  FileAudioIcon,
  FileTextIcon,
  FileIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react"
import { Dialogs, Events } from "@wailsio/runtime"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { Medium } from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"
import { cn } from "@/lib/utils"
import { useDebounce } from "@/hooks/use-debounce"

type Kind = "all" | "image" | "video" | "audio" | "pdf"
const DROP_EVENT = "media:files-dropped"
const DROP_TARGET = "library-media"

type DropPayload = {
  paths?: string[]
  target_id?: string
  target_attrs?: Record<string, string>
}

export function MediaTab() {
  const qc = useQueryClient()
  const { data: media, isLoading } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
  })
  const [search, setSearch] = useState("")
  const [kind, setKind] = useState<Kind>("all")
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)

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

  async function importPaths(paths: string[]) {
    if (paths.length === 0) return
    setImporting(true)
    try {
      await Media.ImportFiles(paths)
      qc.invalidateQueries({ queryKey: ["media", "list"] })
    } finally {
      setImporting(false)
    }
  }

  async function openFileDialog() {
    const picked = await Dialogs.OpenFile({
      Title: "Add media",
      AllowsMultipleSelection: true,
      CanChooseFiles: true,
      CanChooseDirectories: false,
      Filters: [
        {
          DisplayName: "Media (images, videos, audio, PDF)",
          Pattern:
            "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.mp4;*.webm;*.mov;*.mp3;*.wav;*.ogg;*.pdf",
        },
        { DisplayName: "All files", Pattern: "*.*" },
      ],
    })
    const paths = Array.isArray(picked)
      ? picked
      : typeof picked === "string" && picked
        ? [picked]
        : []
    await importPaths(paths)
  }

  // Wails bridges native file drops as `media:files-dropped`. We claim
  // drops landing on this tab via the target_id we set on the drop area.
  useEffect(() => {
    const off = Events.On(DROP_EVENT, (event: { data?: DropPayload }) => {
      const data = event?.data ?? {}
      if (data.target_id !== DROP_TARGET) return
      const paths = data.paths ?? []
      if (paths.length === 0) return
      void importPaths(paths)
    })
    return () => {
      Events.Off(DROP_EVENT)
      void off
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 px-2">
        <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search media"
          className="h-6 border-0 bg-transparent px-0 py-0 text-xs shadow-none focus-visible:ring-0"
        />
        <KindChip current={kind} value="all" label="All" onSelect={setKind} />
        <KindChip
          current={kind}
          value="image"
          label="Images"
          onSelect={setKind}
        />
        <KindChip
          current={kind}
          value="video"
          label="Videos"
          onSelect={setKind}
        />
        <KindChip
          current={kind}
          value="audio"
          label="Audio"
          onSelect={setKind}
        />
        <KindChip current={kind} value="pdf" label="PDFs" onSelect={setKind} />
      </div>

      <div
        data-file-drop-target={DROP_TARGET}
        className="relative min-h-0 flex-1 overflow-y-auto p-3"
      >
        {isLoading ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground/40">
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <button
            type="button"
            onClick={openFileDialog}
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
                  <div className="grid aspect-video w-full place-items-center bg-muted/40 text-muted-foreground/60">
                    <Icon className="size-6 opacity-70" />
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
              onClick={openFileDialog}
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

function KindChip({
  current,
  value,
  label,
  onSelect,
}: {
  current: Kind
  value: Kind
  label: string
  onSelect: (k: Kind) => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        "h-5 rounded px-2 text-[10px] font-medium uppercase tracking-wider transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
      )}
    >
      {label}
    </button>
  )
}
