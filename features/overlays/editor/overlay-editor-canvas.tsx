import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/button"
import { useDisplays } from "@/features/displays/api"
import {
  overlayShownOn,
  type OverlayLayout,
  type OverlayLayouts,
} from "@/features/overlays/types"
import { useOverlayEditor } from "./overlay-editor"
import { applyDrag, sameBox, type Guides, type Handle } from "./drag"

// OverlayEditorCanvas renders in the CENTER (show) pane while the
// overlay-editor surface is open: a 16:9 stage with the widget at the
// layout being edited. The widget box is directly manipulable — drag
// to move, drag a handle to resize — and edits commit once on release
// (the options pane's numeric fields stay in sync through the shared
// editor state).
//
// The toolbar picks WHICH layout the canvas edits: the default, or a
// display's own override (dragging on a display without one creates
// it). Widgets that declare previewStates also get phase buttons that
// simulate a running widget, so colours and attention effects can be
// checked before going live.

const HANDLES: { h: Exclude<Handle, "move">; className: string }[] = [
  { h: "nw", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize" },
  { h: "n", className: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize" },
  { h: "ne", className: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize" },
  { h: "e", className: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize" },
  { h: "se", className: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize" },
  { h: "s", className: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize" },
  { h: "sw", className: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize" },
  { h: "w", className: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize" },
]

export function OverlayEditorCanvas() {
  const {
    overlay,
    def,
    config,
    layouts,
    commitLayouts,
    rules,
    layoutTarget,
    setLayoutTarget,
  } = useOverlayEditor()
  const { data: displays } = useDisplays()
  const stageRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ layout: OverlayLayout; guides: Guides } | null>(null)
  const dragRef = useRef<OverlayLayout | null>(null)
  const [preview, setPreview] = useState<{ label: string; at: number } | null>(null)

  if (!overlay || !def) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
        Loading…
      </div>
    )
  }

  const targetDisplay =
    layoutTarget === "default"
      ? null
      : (displays ?? []).find((d) => String(d.id) === layoutTarget) ?? null
  // A stale target (display deleted) falls back to the default.
  const target = targetDisplay ? layoutTarget : "default"
  const hasOverride = target !== "default" && target in layouts.displays
  const committed =
    target === "default" ? layouts.default : layouts.displays[target] ?? layouts.default
  const layout = drag?.layout ?? committed
  const hiddenHere = targetDisplay ? !overlayShownOn(rules, targetDisplay.id) : false
  const previewStates = def.previewStates?.(config) ?? []

  function commit(next: OverlayLayout) {
    const updated: OverlayLayouts =
      target === "default"
        ? { ...layouts, default: next }
        : { ...layouts, displays: { ...layouts.displays, [target]: next } }
    commitLayouts(updated)
  }

  function startDrag(e: React.PointerEvent, handle: Handle) {
    const stage = stageRef.current
    if (!stage || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const rect = stage.getBoundingClientRect()
    const start = { x: e.clientX, y: e.clientY, layout: committed }
    dragRef.current = null

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / rect.width
      const dy = (ev.clientY - start.y) / rect.height
      const res = applyDrag(start.layout, handle, dx, dy, {
        keepRatio: ev.shiftKey,
        snap: !ev.altKey,
      })
      dragRef.current = res.layout
      setDrag(res)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
      const next = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (next && !sameBox(next, start.layout)) commit(next)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
  }

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
          Layout
        </span>
        <Chip active={target === "default"} onClick={() => setLayoutTarget("default")}>
          Default
        </Chip>
        {(displays ?? []).map((d) => {
          const key = String(d.id)
          return (
            <Chip
              key={d.id}
              active={target === key}
              onClick={() => setLayoutTarget(key)}
              title={key in layouts.displays ? "Custom layout on this display" : "Uses the default layout"}
            >
              {d.name}
              {key in layouts.displays && (
                <span className="ml-1 inline-block size-1.5 rounded-full bg-chart-1 align-middle" />
              )}
            </Chip>
          )
        })}
        {previewStates.length > 0 && (
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Preview
            </span>
            <Chip active={!preview} onClick={() => setPreview(null)}>
              Idle
            </Chip>
            {previewStates.map((p) => (
              <Chip
                key={p.label}
                active={preview?.label === p.label}
                onClick={() => setPreview({ label: p.label, at: Date.now() - p.elapsedMs })}
              >
                {p.label}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 grid place-items-center p-6">
          {/* 16:9 stage so the preview maps cleanly to a typical output
              window. Overlays are ALWAYS transparent — the checker (same
              theme-aware pattern as the template editor) visualizes
              that; live output renders true transparency over whatever
              the lower channels are showing. The widget wrapper marks
              itself as a size query container so renderers' cqh-based
              font sizes scale with the wrapper. */}
          <div
            ref={stageRef}
            className="relative aspect-video w-full max-w-[960px] select-none border border-border/30"
            style={{
              backgroundColor: "var(--background)",
              backgroundImage:
                "repeating-conic-gradient(" +
                "color-mix(in oklch, var(--foreground) 7%, transparent) 0% 25%, " +
                "transparent 0% 50%)",
              backgroundSize: "28px 28px",
            }}
          >
            {drag?.guides.v.map((x) => (
              <div
                key={`v${x}`}
                className="pointer-events-none absolute inset-y-0 w-px bg-chart-1"
                style={{ left: `${x * 100}%` }}
              />
            ))}
            {drag?.guides.h.map((y) => (
              <div
                key={`h${y}`}
                className="pointer-events-none absolute inset-x-0 h-px bg-chart-1"
                style={{ top: `${y * 100}%` }}
              />
            ))}
            <div
              className={cn(
                "group absolute cursor-move outline outline-1 outline-chart-1/70 hover:outline-chart-1",
                drag && "outline-chart-1",
                hiddenHere && "opacity-30"
              )}
              style={{
                left: `${(layout.x - layout.w / 2) * 100}%`,
                top: `${(layout.y - layout.h / 2) * 100}%`,
                width: `${layout.w * 100}%`,
                height: `${layout.h * 100}%`,
              }}
              onPointerDown={(e) => startDrag(e, "move")}
            >
              <div className="pointer-events-none absolute inset-0" style={{ containerType: "size" }}>
                <def.Renderer config={config} style={layout.style} activatedAt={preview?.at} />
              </div>
              {HANDLES.map(({ h, className }) => (
                <span
                  key={h}
                  onPointerDown={(e) => startDrag(e, h)}
                  className={cn(
                    "absolute size-2.5 rounded-[2px] border border-chart-1 bg-background",
                    className
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-3 border-t border-border/50 px-3 text-[10px] text-muted-foreground/70">
        <span className="tabular-nums">
          x {fmt(layout.x)} · y {fmt(layout.y)} · w {fmt(layout.w)} · h {fmt(layout.h)}
        </span>
        <span className="hidden lg:inline">
          Drag to move · handles resize · Shift keeps proportions · Alt turns off snapping
        </span>
        {targetDisplay && (
          <span className="ml-auto flex items-center gap-2">
            {hiddenHere && (
              <span className="text-destructive">Hidden on {targetDisplay.name} (see Show on)</span>
            )}
            {hasOverride ? (
              <>
                <span>Custom layout for {targetDisplay.name}</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    const next = { ...layouts.displays }
                    delete next[target]
                    commitLayouts({ ...layouts, displays: next })
                  }}
                  className="h-5 px-1.5 text-[10px] uppercase tracking-wider text-destructive hover:text-destructive"
                >
                  Reset to default
                </Button>
              </>
            ) : (
              <span>Uses the default · dragging here customizes {targetDisplay.name}</span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-6 px-2 text-[11px] font-normal",
        active
          ? "bg-muted text-foreground hover:bg-muted"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Button>
  )
}

function fmt(n: number): string {
  return n.toFixed(3).replace(/\.?0+$/, "") || "0"
}
