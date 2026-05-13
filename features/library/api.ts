import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Service as Songs } from "@/bindings/neoprojector/services/songs"
import type { SongFull } from "@/bindings/neoprojector/services/songs"
import type { Song } from "@/bindings/neoprojector/database"

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
    mutationFn: (id: number) => Songs.DeleteSong(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libraryKeys.songs })
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
