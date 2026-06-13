import { useOverlayEditor } from "./overlay-editor"

// OverlayEditorCanvas renders in the CENTER (show) pane while the
// overlay-editor surface is open: a 16:9 stage with the widget at its
// default layout. Edits in the options pane flow through immediately.
export function OverlayEditorCanvas() {
  const { overlay, def, config, layouts } = useOverlayEditor()

  if (!overlay || !def) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
        Loading…
      </div>
    )
  }

  const layout = layouts.default
  return (
    <div className="relative h-full w-full bg-background">
      <div className="absolute inset-0 grid place-items-center p-6">
        {/* 16:9 stage so the preview maps cleanly to a typical output
            window. Overlays are ALWAYS transparent — the checker (same
            theme-aware pattern as the template editor) visualizes
            that; live output renders true transparency over whatever
            the lower channels are showing. The widget wrapper marks
            itself as a size query container so renderers' cqh-based
            font sizes scale with the wrapper. */}
        <div
          className="relative aspect-video w-full max-w-[960px] overflow-hidden border border-border/30"
          style={{
            backgroundColor: "var(--background)",
            backgroundImage:
              "repeating-conic-gradient(" +
              "color-mix(in oklch, var(--foreground) 7%, transparent) 0% 25%, " +
              "transparent 0% 50%)",
            backgroundSize: "28px 28px",
          }}
        >
          <div
            className="absolute"
            style={{
              left: `${(layout.x - layout.w / 2) * 100}%`,
              top: `${(layout.y - layout.h / 2) * 100}%`,
              width: `${layout.w * 100}%`,
              height: `${layout.h * 100}%`,
              containerType: "size",
            }}
          >
            <def.Renderer config={config} style={layout.style} />
          </div>
        </div>
      </div>
    </div>
  )
}
