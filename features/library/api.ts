import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import type { SongFull } from "@/bindings/neoprojector/services/songs"
import type { Song } from "@/bindings/neoprojector/database"
import { removeSong } from "@/lib/library-sync"

export const libraryKeys = {
  songs: ["songs", "list"] as const,
  song: (id: number) => ["songs", "full", id] as const,
}

export function useLibrarySongs() {
  return useQuery({
    queryKey: libraryKeys.songs,
    queryFn: () => Songs.ListSongs() as unknown as Promise<Song[]>,
  })
}

export function useLibrarySong(id: number | null) {
  return useQuery({
    queryKey: libraryKeys.song(id ?? 0),
    queryFn: () => Songs.GetSong(id!) as unknown as Promise<SongFull>,
    enabled: !!id,
  })
}

export function useDeleteSong() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      // Delete locally first so the UI never lies about success even if the
      // cloud call fails. The cloud delete is best-effort; phase-6 outbox
      // will replay it on next sync if it does fail.
      await Songs.DeleteSong(id)
      await removeSong(id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.songs })
      qc.invalidateQueries({ queryKey: ["dashboard", "library"] })
    },
  })
}

// Call after creating or updating a song so list + detail caches refresh.
export function useInvalidateSongs() {
  const qc = useQueryClient()
  return (songId?: number) => {
    qc.invalidateQueries({ queryKey: libraryKeys.songs })
    if (songId) qc.invalidateQueries({ queryKey: libraryKeys.song(songId) })
  }
}
