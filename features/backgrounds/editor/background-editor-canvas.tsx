import { useMemo } from "react"
import { BackgroundView } from "@/features/backgrounds/background-view"
import { useBackgroundEditor } from "./background-editor"

// BackgroundEditorCanvas: live preview of the WORKING config in the
// CENTER (show) pane — knob edits render before they even hit the
// autosave. A bounded 16:9 stage (like the overlay editor and the
// library thumbnails), not full-bleed: the stage shows exactly the
// audience aspect so composition reads true, and the surrounding
// app background keeps it visually anchored as a preview.
export function BackgroundEditorCanvas() {
  const { id, config, isLoading } = useBackgroundEditor()

  const snapshot = useMemo(
    () => ({
      background_id: id,
      engine: "gradflow",
      config_json: JSON.stringify(config),
    }),
    [id, config]
  )

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
        Loading…
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-background">
      <div className="absolute inset-0 grid place-items-center p-6">
        <div className="relative aspect-video w-full max-w-[960px] overflow-hidden border border-border/30 bg-black">
          <BackgroundView background={snapshot} />
        </div>
      </div>
    </div>
  )
}
