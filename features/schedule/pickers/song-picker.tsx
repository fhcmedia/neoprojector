import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { MusicIcon, PlusIcon, SearchIcon } from "lucide-react"
import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import type { Song } from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"
import { Button } from "@/components/button"
import { useAddSongItem } from "../api"
import { SongEditor } from "./song-editor"

export function SongPicker({
  sectionId,
  onAdded,
}: {
  sectionId: number
  onAdded: () => void
}) {
  const [mode, setMode] = useState<"list" | "editor">("list")

  if (mode === "editor") {
    return (
      <SongEditor
        mode="create"
        sectionId={sectionId}
        onSaved={onAdded}
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
  onAdded: () => void
  onCreateNew: () => void
}) {
  const { data: songs, isLoading } = useQuery({
    queryKey: ["songs", "list"],
    queryFn: () => Songs.ListSongs() as unknown as Promise<Song[]>,
  })
  const addMut = useAddSongItem(sectionId)
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    if (!songs) return []
    if (!query.trim()) return songs
    const q = query.toLowerCase()
    return songs.filter((s) => s.title.toLowerCase().includes(q))
  }, [songs, query])

  function pick(songId: number) {
    addMut.mutate(songId, { onSuccess: onAdded })
  }

  return (
    <div className="flex h-full flex-col gap-2 pt-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs…"
            className="h-8 pl-8 text-xs"
            autoFocus
          />
        </div>
        <Button type="button" size="sm" onClick={onCreateNew}>
          <PlusIcon className="size-3.5" />
          New song
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto rounded-md border border-border/50">
        {isLoading ? (
          <Empty>Loading…</Empty>
        ) : filtered.length === 0 ? (
          <Empty>
            {songs && songs.length === 0
              ? "No songs in your library yet. Click New song to create one."
              : "No matches."}
          </Empty>
        ) : (
          filtered.map((song) => (
            <button
              key={song.id}
              type="button"
              onClick={() => pick(song.id)}
              className="flex w-full items-center gap-2 border-b border-border/30 px-3 py-2 text-left text-xs last:border-0 hover:bg-muted/50"
            >
              <MusicIcon className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">{song.title}</span>
            </button>
          ))
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
