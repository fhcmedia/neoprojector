import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckIcon, MusicIcon, PlusIcon, SearchIcon } from "lucide-react"
import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import type { Song } from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"
import { cn } from "@/lib/utils"
import { SongEditor } from "@/features/songs/song-editor"
import { useAddSongItem, useItems } from "@/features/schedule/api"

export function SongPicker({
  sectionId,
  onAdded,
}: {
  sectionId: number
  onAdded: (newItemId?: number) => void
}) {
  const [mode, setMode] = useState<"list" | "editor">("list")
  const addMut = useAddSongItem(sectionId)

  if (mode === "editor") {
    return (
      <SongEditor
        mode="create"
        // Live-save attaches the freshly created song to the section but
        // keeps the editor open — the user can keep typing. They back out
        // via the panel's Back button when done.
        onSaved={(songId) => {
          addMut.mutate(songId)
        }}
        onCancel={() => setMode("list")}
      />
    )
  }

  return (
    <SongList
      sectionId={sectionId}
      onAdded={onAdded}
      onCreateNew={() => setMode("editor")}
    />
  )
}

function SongList({
  sectionId,
  onAdded,
  onCreateNew,
}: {
  sectionId: number
  onAdded: (newItemId?: number) => void
  onCreateNew: () => void
}) {
  const { data: songs, isLoading } = useQuery({
    queryKey: ["songs", "list"],
    queryFn: () => Songs.ListSongs() as unknown as Promise<Song[]>,
  })
  const { data: existingItems } = useItems(sectionId)
  const addMut = useAddSongItem(sectionId)
  const [query, setQuery] = useState("")

  // Songs already in this section — adding the same song twice to the
  // same section is disallowed (different sections in the same service
  // are still fine).
  const alreadyInSection = useMemo(() => {
    const set = new Set<number>()
    for (const item of existingItems ?? []) {
      if (item.kind === "song" && item.song_id) set.add(item.song_id)
    }
    return set
  }, [existingItems])

  const filtered = useMemo(() => {
    if (!songs) return []
    if (!query.trim()) return songs
    const q = query.toLowerCase()
    return songs.filter((s) => s.title.toLowerCase().includes(q))
  }, [songs, query])

  function pick(songId: number) {
    if (alreadyInSection.has(songId)) return
    addMut.mutate(songId, {
      onSuccess: (item) => onAdded(item?.id),
    })
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <button
          type="button"
          onClick={onCreateNew}
          aria-label="New song"
          className="grid size-8 shrink-0 place-items-center rounded-md border border-border/50 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto rounded-md border border-border/50">
        {isLoading ? (
          <Empty>Loading…</Empty>
        ) : filtered.length === 0 ? (
          <Empty>
            {songs && songs.length === 0
              ? "No songs yet. + to create."
              : "No matches."}
          </Empty>
        ) : (
          filtered.map((song) => {
            const inSection = alreadyInSection.has(song.id)
            return (
              <button
                key={song.id}
                type="button"
                disabled={inSection}
                onClick={() => pick(song.id)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border/30 px-3 py-2 text-left text-xs last:border-0",
                  inSection
                    ? "cursor-not-allowed text-muted-foreground/50"
                    : "hover:bg-muted/50"
                )}
              >
                <MusicIcon className="size-3.5 shrink-0 opacity-70" />
                <span className="truncate">{song.title}</span>
                {inSection && (
                  <CheckIcon className="ml-auto size-3 shrink-0 text-chart-2/70" />
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
      {children}
    </div>
  )
}
