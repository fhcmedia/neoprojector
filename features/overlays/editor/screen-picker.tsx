import { useMemo, useState } from "react"
import { CheckIcon, MonitorIcon, MonitorOffIcon, PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog"
import { Input } from "@/components/input"
import {
  useCreateDisplay,
  useDisplays,
  useScreens,
  useSetDisplayScreen,
} from "@/features/displays/api"
import { DisplaySurface } from "@/features/displays/display-preview-pane"
import { BackgroundStage } from "@/features/backgrounds/background-stage"
import { useTemplates } from "@/features/library/templates-api"
import { useLive } from "@/features/live/live-context"
import { resolveLayout, type OverlayLayouts } from "@/features/overlays/types"
import type { Display, Template } from "@/bindings/neoprojector/database"
import type { ScreenInfo } from "@/bindings/neoprojector/services/displays"
import { useOverlayEditor } from "./overlay-editor"

// ScreenPicker: the overlay editor's "Show on" control. Opens a window
// that draws the operator's real monitor arrangement (positions and
// sizes from the OS), each monitor showing a live mirror of what its
// display is putting out right now with this overlay drawn where it
// would land. Clicking a monitor toggles the overlay on it.
//
// Overlays target NeoProjector displays (rules.display_ids), not raw
// monitors, so a monitor with no display bound to it can't be picked
// directly; the picker offers to set one up (e.g. a stage screen for
// the sermon timer). The primary monitor is the operator's control
// screen and is never offered, since an output window would cover the
// app. Displays bound to a disconnected monitor (or none) are listed
// underneath so they can still be targeted.

type Selection = number[] | undefined

export function ScreenPicker({
  selected,
  onChange,
}: {
  selected: Selection
  onChange: (next: Selection) => void
}) {
  const [open, setOpen] = useState(false)
  const { data: displays } = useDisplays()
  const list = displays ?? []
  const isOn = (id: number) => !selected || selected.includes(id)
  const onNames = list.filter((d) => isOn(d.id)).map((d) => d.name)
  const summary =
    list.length === 0
      ? "No displays set up yet"
      : !selected
        ? "All displays"
        : onNames.length === 0
          ? "Not shown anywhere"
          : onNames.join(", ")

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full justify-start gap-2 px-2 font-normal"
      >
        <MonitorIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[11px]",
            onNames.length === 0 ? "text-destructive" : "text-foreground"
          )}
        >
          {summary}
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
          Choose screens
        </span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(960px,95vw)] max-w-none gap-4 sm:max-w-none">
          <DialogHeader>
            <DialogTitle>Show this overlay on…</DialogTitle>
            <DialogDescription>
              Your monitors, laid out the way they're arranged in Windows. Each
              one shows what it's displaying right now, with this overlay drawn
              where it would appear. Click a screen to turn the overlay on or off
              there.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <PickerBody displays={list} selected={selected} onChange={onChange} />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function PickerBody({
  displays,
  selected,
  onChange,
}: {
  displays: Display[]
  selected: Selection
  onChange: (next: Selection) => void
}) {
  const { data: screens } = useScreens()
  const { data: templates } = useTemplates()
  const { live, activeOverlays, serviceBackground } = useLive()
  const { layouts, def, config } = useOverlayEditor()
  const templateById = useMemo(() => {
    const map = new Map<number, Template>()
    for (const t of templates ?? []) map.set(t.id, t)
    return map
  }, [templates])

  const isOn = (id: number) => !selected || selected.includes(id)
  function toggle(id: number) {
    const on = new Set(displays.filter((d) => isOn(d.id)).map((d) => d.id))
    if (on.has(id)) on.delete(id)
    else on.add(id)
    onChange(on.size === displays.length ? undefined : [...on])
  }

  // Monitors numbered left-to-right, top-to-bottom like Windows'
  // display settings reads them.
  const sorted = useMemo(
    () => [...(screens ?? [])].sort((a, b) => a.x - b.x || a.y - b.y),
    [screens]
  )
  const screenIds = new Set(sorted.map((s) => s.id))
  const unplaced = displays.filter(
    (d) => !d.screen_id.Valid || !screenIds.has(d.screen_id.String)
  )
  const surfaceProps = { templateById, live, activeOverlays, serviceBackground }
  const draft =
    def && config ? { layouts, Renderer: def.Renderer, config } : null

  return (
    <BackgroundStage background={live?.background ?? serviceBackground ?? null}>
      <div className="flex flex-col gap-4">
        <Arrangement
          screens={sorted}
          render={(sc, idx) => {
            const bound = displays.find(
              (d) => d.screen_id.Valid && d.screen_id.String === sc.id
            )
            return (
              <MonitorCard
                key={sc.id}
                index={idx + 1}
                screen={sc}
                display={bound}
                selected={bound ? isOn(bound.id) : false}
                onToggle={bound ? () => toggle(bound.id) : undefined}
                surface={
                  bound ? (
                    <DisplaySurface display={bound} {...surfaceProps}>
                      {draft && isOn(bound.id) && (
                        <DraftOverlay displayId={bound.id} draft={draft} />
                      )}
                    </DisplaySurface>
                  ) : null
                }
                onSetUp={
                  !bound && !sc.is_primary
                    ? (displayId) => {
                        // A display made from here exists to carry this
                        // overlay, so make sure it's selected.
                        if (selected) onChange([...selected, displayId])
                      }
                    : undefined
                }
              />
            )
          }}
        />
        {sorted.length === 0 && (
          <div className="text-xs text-muted-foreground">Looking for monitors…</div>
        )}
        {unplaced.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Displays without a connected monitor
            </div>
            <div className="flex flex-wrap gap-2">
              {unplaced.map((d) => (
                <Button
                  key={d.id}
                  variant="outline"
                  size="sm"
                  aria-pressed={isOn(d.id)}
                  onClick={() => toggle(d.id)}
                  className={cn(
                    "text-[11px] font-normal",
                    isOn(d.id)
                      ? "border-chart-1 bg-chart-1/10 text-foreground dark:border-chart-1"
                      : "text-muted-foreground"
                  )}
                >
                  <MonitorOffIcon className="size-3.5" />
                  {d.name}
                  {isOn(d.id) && <CheckIcon className="size-3.5 text-chart-1" />}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border/50 pt-3">
          <span className="text-[11px] text-muted-foreground">
            New displays only light up after the next Go Live.
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(undefined)}
            disabled={!selected}
            className="text-[11px] font-normal text-muted-foreground"
          >
            Show on all displays
          </Button>
        </div>
      </div>
    </BackgroundStage>
  )
}

// Arrangement scales the physical desktop layout into the dialog width,
// keeping every monitor's true proportions and relative position.
function Arrangement({
  screens,
  render,
}: {
  screens: ScreenInfo[]
  render: (sc: ScreenInfo, idx: number) => React.ReactNode
}) {
  if (screens.length === 0) return null
  const minX = Math.min(...screens.map((s) => s.x))
  const minY = Math.min(...screens.map((s) => s.y))
  const maxX = Math.max(...screens.map((s) => s.x + (s.px_width || s.width)))
  const maxY = Math.max(...screens.map((s) => s.y + (s.px_height || s.height)))
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  return (
    <div
      className="relative w-full"
      // Cap the height so a tall stacked layout doesn't overflow.
      style={{ aspectRatio: `${w} / ${h}`, maxHeight: "52vh", margin: "0 auto" }}
    >
      {screens.map((sc, i) => (
        <div
          key={sc.id}
          className="absolute p-1.5"
          style={{
            left: `${((sc.x - minX) / w) * 100}%`,
            top: `${((sc.y - minY) / h) * 100}%`,
            width: `${((sc.px_width || sc.width) / w) * 100}%`,
            height: `${((sc.px_height || sc.height) / h) * 100}%`,
          }}
        >
          {render(sc, i)}
        </div>
      ))}
    </div>
  )
}

function MonitorCard({
  index,
  screen,
  display,
  selected,
  onToggle,
  surface,
  onSetUp,
}: {
  index: number
  screen: ScreenInfo
  display: Display | undefined
  selected: boolean
  onToggle?: () => void
  surface: React.ReactNode
  onSetUp?: (displayId: number) => void
}) {
  const res = `${screen.px_width || screen.width}×${screen.px_height || screen.height}`
  const clickable = !!onToggle
  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? selected : undefined}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onToggle()
        }
      }}
      className={cn(
        "group flex h-full w-full flex-col overflow-hidden rounded-md border-2 bg-black transition-colors",
        clickable && "cursor-pointer",
        selected
          ? "border-chart-1 shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-chart-1)_25%,transparent)]"
          : clickable
            ? "border-border/60 hover:border-border"
            : "border-border/30"
      )}
    >
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        style={{ containerType: "size" }}
      >
        {surface ? (
          // "Contain"-fit the 16:9 mirror inside whatever space the card
          // leaves after its label strip, so it's never cropped.
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div style={{ width: "min(100cqw, calc(100cqh * 16 / 9))" }}>{surface}</div>
          </div>
        ) : (
          <EmptyMonitor isPrimary={screen.is_primary} screen={screen} onSetUp={onSetUp} />
        )}
        <span className="pointer-events-none absolute left-1.5 top-1.5 grid size-6 place-items-center rounded bg-background/80 text-[11px] font-semibold text-foreground backdrop-blur">
          {index}
        </span>
        {clickable && (
          <span
            className={cn(
              "pointer-events-none absolute right-1.5 top-1.5 grid size-6 place-items-center rounded border transition-colors",
              selected
                ? "border-chart-1 bg-chart-1 text-white"
                : "border-border/70 bg-background/70 text-transparent group-hover:text-muted-foreground"
            )}
          >
            <CheckIcon className="size-3.5" />
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border/40 bg-background/90 px-2 py-1">
        <span className="truncate text-[11px] font-medium text-foreground">
          {display ? display.name : screen.is_primary ? "Control screen" : "Not set up"}
        </span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {res}
          {screen.is_primary ? " · main" : ""}
        </span>
      </div>
    </div>
  )
}

// EmptyMonitor is a monitor no display is bound to. The primary is the
// operator's own screen; any other can be turned into a display.
function EmptyMonitor({
  isPrimary,
  screen,
  onSetUp,
}: {
  isPrimary: boolean
  screen: ScreenInfo
  onSetUp?: (displayId: number) => void
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("Stage")
  const createMut = useCreateDisplay()
  const bindMut = useSetDisplayScreen()
  const busy = createMut.isPending || bindMut.isPending

  async function create() {
    const d = await createMut.mutateAsync(name.trim() || "Stage")
    await bindMut.mutateAsync({ id: d.id, screenID: screen.id })
    onSetUp?.(d.id)
    setNaming(false)
  }

  if (isPrimary) {
    return (
      <div className="grid h-full place-items-center p-3 text-center text-[11px] text-muted-foreground/70">
        This is the screen NeoProjector runs on.
      </div>
    )
  }
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center"
      onClick={(e) => e.stopPropagation()}
    >
      {naming ? (
        <form
          className="flex w-full max-w-[220px] flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name, e.g. Stage"
            className="h-7 text-xs"
          />
          <Button type="submit" size="xs" disabled={busy}>
            {busy ? "Setting up…" : "Use this monitor"}
          </Button>
        </form>
      ) : (
        <>
          <span className="text-[11px] text-muted-foreground">
            Not used by NeoProjector yet
          </span>
          {onSetUp && (
            <Button variant="outline" size="xs" onClick={() => setNaming(true)}>
              <PlusIcon />
              Set up as a display
            </Button>
          )}
        </>
      )}
    </div>
  )
}

// DraftOverlay draws the overlay being edited (its current, unsaved-
// to-schedule config) onto a monitor's mirror at that display's layout,
// outlined so it reads as "this is where it'll go".
function DraftOverlay({
  displayId,
  draft,
}: {
  displayId: number
  draft: {
    layouts: OverlayLayouts
    Renderer: React.ComponentType<{
      config: any
      style: Record<string, unknown>
      activatedAt?: number
    }>
    config: Record<string, unknown>
  }
}) {
  const layout = resolveLayout(draft.layouts, displayId)
  const { Renderer } = draft
  return (
    <div
      className="pointer-events-none absolute outline outline-1 outline-dashed outline-chart-1"
      style={{
        left: `${(layout.x - layout.w / 2) * 100}%`,
        top: `${(layout.y - layout.h / 2) * 100}%`,
        width: `${layout.w * 100}%`,
        height: `${layout.h * 100}%`,
        containerType: "size",
      }}
    >
      <Renderer config={draft.config} style={layout.style} />
    </div>
  )
}
