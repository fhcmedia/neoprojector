import { ArrowLeftIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  type OverlayLayout,
  type OverlayLayouts,
} from "@/features/overlays/types"
import { useDisplays } from "@/features/displays/api"
import { Input } from "@/components/input"
import { Button } from "@/components/button"
import { Checkbox } from "@/components/checkbox"
import { OptionSelect } from "@/components/option-select"
import { ColorPickerButton } from "@/features/templates/editor/fields"
import { ANIM_KINDS, type AnimKind } from "@/features/animations/variants"
import type { Display } from "@/bindings/neoprojector/database"
import { useOverlayEditor } from "./overlay-editor"
import { ScreenPicker } from "./screen-picker"

// OverlayEditorOptions renders in the LEFT (schedule) pane while the
// overlay-editor surface is open: identity header, widget config,
// behavior rules, and layout editors (default + per-display).
export function OverlayEditorOptions() {
  const {
    overlay,
    def,
    isSeed,
    isShadowed,
    name,
    setName,
    commitName,
    config,
    commitConfig,
    layouts,
    commitLayouts,
    rules,
    commitRules,
    onClose,
  } = useOverlayEditor()
  const { data: displays } = useDisplays()

  if (!overlay || !def) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Close editor"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
        </Button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={(e) => commitName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
          }}
          className="h-6 flex-1 rounded-none border-0 bg-transparent px-1 py-0 text-xs font-medium shadow-none focus-visible:bg-muted/40 focus-visible:ring-0 dark:bg-transparent"
        />
        {isSeed && (
          <span className="shrink-0 rounded bg-muted/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {isShadowed ? "Edited" : "Default"}
          </span>
        )}
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {def.label}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Section title="Function">
          <fieldset className="flex flex-col gap-3">
            <def.ConfigEditor
              config={config}
              onChange={(next) => commitConfig(next)}
            />
          </fieldset>
        </Section>
        <Section
          title="Behavior"
          help="Rules that govern how this overlay coexists with other content."
        >
          <label className="flex cursor-pointer items-start gap-2 text-[11px] text-muted-foreground">
            <Checkbox
              checked={rules.cover_slide ?? false}
              onCheckedChange={(v) =>
                commitRules({ ...rules, cover_slide: v === true })
              }
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium text-foreground">
                Cover slide content
              </span>
              <span className="block text-[10px] text-muted-foreground/70">
                While this overlay is active, hide the bible/song/media
                template underneath. Best for countdowns and pre-service
                screens that own the canvas.
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-[11px] text-muted-foreground">
            <Checkbox
              checked={rules.sticky ?? false}
              onCheckedChange={(v) =>
                commitRules({ ...rules, sticky: v === true })
              }
              className="mt-0.5"
            />
            <span>
              <span className="block font-medium text-foreground">
                Sticky
              </span>
              <span className="block text-[10px] text-muted-foreground/70">
                Stays on screen above everything — bible verses, songs,
                presentations — and Esc won't clear it. Turn it off by
                clicking its schedule item again.
              </span>
            </span>
          </label>
        </Section>
        <Section
          title="Show on"
          help="Which screens this overlay appears on."
        >
          <ScreenPicker
            selected={rules.display_ids}
            onChange={(display_ids) => {
              const next = { ...rules }
              if (display_ids === undefined) delete next.display_ids
              else next.display_ids = display_ids
              commitRules(next)
            }}
          />
        </Section>
        <Section title="Default layout">
          <LayoutEditor
            layout={layouts.default}
            onChange={(next) =>
              commitLayouts({ ...layouts, default: next })
            }
          />
        </Section>
        <Section
          title="Per-display layouts"
          help="Override the default on specific displays. Same function, positioned and styled differently."
        >
          <PerDisplayLayouts
            displays={displays ?? []}
            layouts={layouts}
            onChange={commitLayouts}
          />
        </Section>
      </div>
    </div>
  )
}

// --- layout editor --------------------------------------------------------

function LayoutEditor({
  layout,
  onChange,
  readOnly,
}: {
  layout: OverlayLayout
  onChange: (next: OverlayLayout) => void
  readOnly?: boolean
}) {
  function field(key: "x" | "y" | "w" | "h", label: string) {
    return (
      <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wider">{label}</span>
        <Input
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={layout[key]}
          disabled={readOnly}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            onChange({ ...layout, [key]: clamp01(n) })
          }}
          className="h-7 text-xs"
        />
      </label>
    )
  }
  const color = (layout.style.color as string | undefined) ?? "#ffffff"
  const entry = (layout.style.entry as AnimKind | undefined) ?? "fade"
  const exit = (layout.style.exit as AnimKind | undefined) ?? entry
  const duration = (layout.style.duration_ms as number | undefined) ?? 220
  const stagger = (layout.style.stagger_ms as number | undefined) ?? 0
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {field("x", "x")}
        {field("y", "y")}
        {field("w", "w")}
        {field("h", "h")}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="uppercase tracking-wider">Color</span>
        <ColorPickerButton
          value={color}
          readOnly={readOnly}
          onChange={(c) =>
            onChange({
              ...layout,
              style: { ...layout.style, color: c },
            })
          }
        />
      </div>
      <AnimSelect
        label="Entry"
        value={entry}
        disabled={readOnly}
        onChange={(v) =>
          onChange({ ...layout, style: { ...layout.style, entry: v } })
        }
      />
      <AnimSelect
        label="Exit"
        value={exit}
        disabled={readOnly}
        onChange={(v) =>
          onChange({ ...layout, style: { ...layout.style, exit: v } })
        }
      />
      <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wider">Duration (ms)</span>
        <Input
          type="number"
          min="0"
          step="20"
          value={duration}
          disabled={readOnly}
          onChange={(e) => {
            const n = Math.max(0, Math.floor(Number(e.target.value) || 0))
            onChange({
              ...layout,
              style: { ...layout.style, duration_ms: n },
            })
          }}
          className="h-7 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wider">Element stagger (ms)</span>
        <Input
          type="number"
          min="0"
          step="10"
          value={stagger}
          disabled={readOnly}
          onChange={(e) => {
            const n = Math.max(0, Math.floor(Number(e.target.value) || 0))
            onChange({
              ...layout,
              style: { ...layout.style, stagger_ms: n },
            })
          }}
          className="h-7 text-xs"
        />
        <span className="text-[10px] normal-case text-muted-foreground/60">
          0 = the whole card animates as one. Above 0, widgets that
          declare elements (e.g. the name card's panel / name /
          subtitle) enter one by one and leave in reverse.
        </span>
      </label>
    </div>
  )
}

const ANIM_OPTIONS = ANIM_KINDS.map((a) => ({ value: a.kind, label: a.label }))

function AnimSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string
  value: AnimKind
  disabled?: boolean
  onChange: (v: AnimKind) => void
}) {
  return (
    <div className="flex flex-col gap-1 text-[10px] text-muted-foreground">
      <span className="uppercase tracking-wider">{label}</span>
      <OptionSelect
        value={value}
        options={ANIM_OPTIONS}
        disabled={disabled}
        onChange={onChange}
        ariaLabel={label}
        className="h-7"
      />
    </div>
  )
}

// --- per-display layouts --------------------------------------------------

function PerDisplayLayouts({
  displays,
  layouts,
  onChange,
  readOnly,
}: {
  displays: Display[]
  layouts: OverlayLayouts
  onChange: (next: OverlayLayouts) => void
  readOnly?: boolean
}) {
  if (displays.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground/60">
        No displays configured. Add one in Settings → Displays first.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {displays.map((d) => {
        const key = String(d.id)
        const has = key in layouts.displays
        const eff = has ? layouts.displays[key] : layouts.default
        return (
          <div
            key={d.id}
            className="rounded border border-border/40 p-2"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-medium">{d.name}</span>
              <Button
                variant="ghost"
                size="xs"
                disabled={readOnly}
                onClick={() => {
                  const next = { ...layouts.displays }
                  if (has) {
                    delete next[key]
                  } else {
                    next[key] = { ...layouts.default }
                  }
                  onChange({ ...layouts, displays: next })
                }}
                className={cn(
                  "h-5 px-1.5 text-[10px] uppercase tracking-wider",
                  has
                    ? "text-destructive hover:text-destructive"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {has ? "Use default" : "Override"}
              </Button>
            </div>
            {has && (
              <LayoutEditor
                layout={eff}
                onChange={(next) =>
                  onChange({
                    ...layouts,
                    displays: { ...layouts.displays, [key]: next },
                  })
                }
                readOnly={readOnly}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// --- helpers --------------------------------------------------------------

function Section({
  title,
  help,
  children,
}: {
  title: string
  help?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2 border-b border-border/40 px-3 py-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </div>
        {help && (
          <div className="mt-0.5 text-[10px] text-muted-foreground/60">
            {help}
          </div>
        )}
      </div>
      {children}
    </section>
  )
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}
