import { useMemo } from "react"
import { useDisplays } from "@/features/displays/api"
import { useTemplates } from "@/features/library/templates-api"
import type { Template } from "@/bindings/neoprojector/database"

// Per-kind fallback to the frontend defaults so a brand-new install
// (no displays yet) or a user who unbound their templates still gets
// a sensible render in the Show pane. -1 = "Bible — One Translation",
// -5 = "Song — Audience" (see features/templates/defaults.ts).
const FALLBACK_ID: Record<"bible" | "song", number> = {
  bible: -1,
  song: -5,
}

// useShowTemplate picks the template the Show pane should render
// slides through. Convention: the first enabled display drives the
// Show pane's appearance ("audience view"). User reorders the
// display list to choose a different driver. Falls back to a default
// template when no display has a binding for the slide's kind.
export function useShowTemplate(kind: "bible" | "song"): Template | undefined {
  const { data: displays } = useDisplays()
  const { data: templates } = useTemplates()

  return useMemo(() => {
    if (!templates) return undefined
    const first = displays?.find((d) => d.enabled !== 0)
    let id: number = FALLBACK_ID[kind]
    if (first) {
      const binding =
        kind === "bible" ? first.bible_template_id : first.song_template_id
      if (binding.Valid) id = binding.Int64
    }
    return templates.find((t) => t.id === id)
  }, [displays, templates, kind])
}
