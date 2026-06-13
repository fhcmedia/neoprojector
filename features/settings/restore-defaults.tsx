import { RotateCcwIcon } from "lucide-react"
import {
  useDeleteTemplate,
  useTemplates,
} from "@/features/library/templates-api"
import { useDeleteOverlay, useOverlays } from "@/features/overlays/api"
import {
  useBackgrounds,
  useDeleteBackground,
} from "@/features/backgrounds/api"
import { defaultTemplates } from "@/features/templates/defaults"
import { DEFAULT_OVERLAYS } from "@/features/overlays/defaults"
import { defaultBackgrounds } from "@/features/backgrounds/presets"

// RestoreDefaultsPanel lists every EDITED default (a seed shadowed by
// a DB row at its negative id) across templates, overlays, and
// backgrounds, with per-item restore and a restore-all per group.
// Restoring deletes the shadow row — the pristine frontend seed shows
// through again everywhere (bindings and schedule assignments keep
// pointing at the same id). Pristine defaults aren't listed; there's
// nothing to restore.
export function RestoreDefaultsPanel() {
  const templates = useTemplates()
  const overlays = useOverlays()
  const backgrounds = useBackgrounds()
  const delTemplate = useDeleteTemplate()
  const delOverlay = useDeleteOverlay()
  const delBackground = useDeleteBackground()

  const groups: {
    label: string
    edited: { id: number; name: string; seedName: string }[]
    restore: (id: number) => void
  }[] = [
    {
      label: "Templates",
      edited: (templates.rows ?? [])
        .filter((r) => r.id < 0)
        .map((r) => ({
          id: r.id,
          name: r.name,
          seedName:
            defaultTemplates.find((s) => s.id === r.id)?.name ?? r.name,
        })),
      restore: (id) => delTemplate.mutate(id),
    },
    {
      label: "Overlays",
      edited: (overlays.rows ?? [])
        .filter((r) => r.id < 0)
        .map((r) => ({
          id: r.id,
          name: r.name,
          seedName:
            DEFAULT_OVERLAYS.find((s) => s.id === r.id)?.name ?? r.name,
        })),
      restore: (id) => delOverlay.mutate(id),
    },
    {
      label: "Backgrounds",
      edited: (backgrounds.rows ?? [])
        .filter((r) => r.id < 0)
        .map((r) => ({
          id: r.id,
          name: r.name,
          seedName:
            defaultBackgrounds.find((s) => s.id === r.id)?.name ?? r.name,
        })),
      restore: (id) => delBackground.mutate(id),
    },
  ]

  const totalEdited = groups.reduce((n, g) => n + g.edited.length, 0)

  return (
    <div className="divide-y divide-border/40">
      {totalEdited === 0 && (
        <div className="py-3 text-[11px] text-muted-foreground">
          All defaults are pristine — edited defaults show up here with
          restore actions.
        </div>
      )}
      {groups.map(
        (g) =>
          g.edited.length > 0 && (
            <div key={g.label} className="py-3">
              <div className="flex items-center justify-between gap-6 pb-2">
                <span className="text-xs font-medium">{g.label}</span>
                <button
                  type="button"
                  onClick={() => g.edited.forEach((e) => g.restore(e.id))}
                  className="flex h-6 items-center gap-1.5 border border-border/50 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <RotateCcwIcon className="size-3" />
                  Restore all
                </button>
              </div>
              <div className="flex flex-col gap-1">
                {g.edited.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-6 py-1"
                  >
                    <span className="truncate text-[11px] text-muted-foreground">
                      {e.name}
                      {e.name !== e.seedName && (
                        <span className="text-muted-foreground/50">
                          {" "}
                          (default: {e.seedName})
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => g.restore(e.id)}
                      className="flex h-6 shrink-0 items-center gap-1.5 border border-border/50 px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <RotateCcwIcon className="size-3" />
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
      )}
    </div>
  )
}
