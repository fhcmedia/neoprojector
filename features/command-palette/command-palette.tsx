import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  BookOpenIcon,
  MusicIcon,
  ImageIcon,
  LayersIcon,
  SettingsIcon,
  RadioIcon,
  XIcon,
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/command"
import { useLibrarySongs } from "@/features/library/api"
import { useLive } from "@/features/live/live-context"

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const { data: songs } = useLibrarySongs()
  const { live, clearLive, activeOverlays, clearOverlays } = useLive()

  function run(fn: () => void) {
    fn()
    onOpenChange(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} showCloseButton={false}>
      <CommandInput placeholder="Search songs, navigate, or run a command…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {(live || activeOverlays.length > 0) && (
          <>
            <CommandGroup heading="Live">
              {live && (
                <CommandItem onSelect={() => run(clearLive)}>
                  <XIcon />
                  Clear live slide
                </CommandItem>
              )}
              {activeOverlays.length > 0 && (
                <CommandItem onSelect={() => run(clearOverlays)}>
                  <XIcon />
                  Clear all overlays ({activeOverlays.length})
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => run(() => navigate({ to: "/" }))}>
            <RadioIcon />
            Projector
          </CommandItem>
          <CommandItem
            onSelect={() =>
              run(() =>
                navigate({
                  to: "/",
                  search: (prev) => ({ ...prev, surface: "settings" }),
                })
              )
            }
          >
            <SettingsIcon />
            Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Library">
          <CommandItem
            onSelect={() =>
              run(() => {
                const el = document.querySelector<HTMLInputElement>(
                  "input[data-library-search]"
                )
                el?.focus()
              })
            }
          >
            <BookOpenIcon />
            Search Bible (/)
          </CommandItem>
        </CommandGroup>

        {songs && songs.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Songs">
              {songs.slice(0, 8).map((song) => (
                <CommandItem
                  key={song.id}
                  value={song.title}
                  onSelect={() =>
                    run(() => {
                      // Land on the library's Songs tab with this title
                      // pre-filtered so the picked song is the only hit
                      // — same session-state keys library-view.tsx uses.
                      try {
                        window.sessionStorage.setItem(
                          "neoprojector.libraryTab",
                          JSON.stringify("songs")
                        )
                        window.sessionStorage.setItem(
                          "neoprojector.songSearch",
                          JSON.stringify(song.title)
                        )
                      } catch {
                        // sessionStorage can throw in private modes;
                        // navigating still puts the user near the song.
                      }
                      navigate({ to: "/" })
                    })
                  }
                >
                  <MusicIcon />
                  {song.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
