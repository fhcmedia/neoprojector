import { useEffect, useMemo, useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { ArrowLeftIcon, ChevronDownIcon, CopyIcon, ImageIcon, LockIcon, SearchIcon } from "lucide-react"
import { HexColorPicker } from "react-colorful"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import {
  useOverlay,
  useSetOverlayConfig,
  useSetOverlayLayouts,
  useSetOverlayRules,
  useRenameOverlay,
  useCreateOverlay,
  buildCreateInputFromOverlay,
} from "@/features/overlays/api"
import { isDefaultOverlayId } from "@/features/overlays/defaults"
import { widgetDef } from "@/features/overlays/widgets"
import {
  DEFAULT_RULES,
  parseConfig,
  parseLayouts,
  parseRules,
  resolveLayout,
  type OverlayLayout,
  type OverlayLayouts,
  type OverlayRules,
  type WidgetKind,
} from "@/features/overlays/types"
import { useDisplays } from "@/features/displays/api"
import { Input } from "@/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/popover"
import { ANIM_KINDS, type AnimKind } from "@/features/animations/variants"
import { DEFAULT_GRADFLOW, type Background, type GradflowConfig } from "@/features/templates/types"
import { BackgroundLayer } from "@/features/templates/renderer"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { Display, Medium } from "@/bindings/neoprojector/database"

export const Route = createFileRoute("/_app/overlays/$overlayId")({
  component: OverlayEditor,
})

function OverlayEditor() {
  const navigate = useNavigate()
  const { overlayId } = Route.useParams()
  const id = Number(overlayId)
  const { data: overlay } = useOverlay(id)
  const { data: displays } = useDisplays()
  const renameMut = useRenameOverlay()
  const configMut = useSetOverlayConfig()
  const layoutsMut = useSetOverlayLayouts()
  const rulesMut = useSetOverlayRules()
  const createMut = useCreateOverlay()

  const readOnly = isDefaultOverlayId(id)

  // Local state seeded from the row. We persist on field commit so
  // the user sees their edit echo back immediately without a save
  // button — same live-save discipline as the song editor.
  const def = overlay ? widgetDef(overlay.kind as WidgetKind) : null
  const [name, setName] = useState("")
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [layouts, setLayouts] = useState<OverlayLayouts>({
    default: { x: 0.5, y: 0.5, w: 0.3, h: 0.15, style: {} },
    displays: {},
  })
  const [rules, setRules] = useState<OverlayRules>(DEFAULT_RULES)

  useEffect(() => {
    if (!overlay || !def) return
    setName(overlay.name)
    setConfig(parseConfig(overlay.config_json, def.defaultConfig))
    setLayouts(parseLayouts(overlay.layouts_json, def.defaultLayout))
    setRules(parseRules(overlay.rules_json, def.defaultRules))
  }, [overlay, def])

  function commitName(next: string) {
    const v = next.trim()
    if (!overlay || readOnly || !v || v === overlay.name) return
    renameMut.mutate({ id: overlay.id, name: v })
  }

  function commitConfig(next: Record<string, unknown>) {
    setConfig(next)
    if (!overlay || readOnly) return
    configMut.mutate({ id: overlay.id, configJSON: JSON.stringify(next) })
  }

  function commitLayouts(next: OverlayLayouts) {
    setLayouts(next)
    if (!overlay || readOnly) return
    layoutsMut.mutate({ id: overlay.id, layoutsJSON: JSON.stringify(next) })
  }

  function commitRules(next: OverlayRules) {
    setRules(next)
    if (!overlay || readOnly) return
    rulesMut.mutate({ id: overlay.id, rulesJSON: JSON.stringify(next) })
  }

  if (!overlay || !def) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border/50 px-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/" })}
          aria-label="Back"
          className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
        </button>
        {readOnly ? (
          <span className="flex items-center gap-1.5 text-xs font-medium">
            <LockIcon className="size-3 text-muted-foreground" />
            {overlay.name}
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
              · default · duplicate to edit
            </span>
          </span>
        ) : (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
            }}
            className="h-7 max-w-[280px] text-xs"
          />
        )}
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
          {def.label}
        </span>
        <span className="flex-1" />
        {readOnly && (
          <button
            type="button"
            onClick={() =>
              createMut.mutate(buildCreateInputFromOverlay(overlay), {
                onSuccess: (copy) =>
                  navigate({
                    to: "/overlays/$overlayId",
                    params: { overlayId: String(copy.id) },
                  }),
              })
            }
            className="flex h-7 items-center gap-1.5 rounded border border-border/50 px-2.5 text-[11px] transition-colors hover:bg-muted"
          >
            <CopyIcon className="size-3" />
            Duplicate to edit
          </button>
        )}
      </header>

      <div className="grid flex-1 min-h-0 grid-cols-[1fr_320px]">
        <div className="relative bg-black">
          {/* Live preview against a black canvas the size of the
              output. Edits flow through immediately. */}
          <PreviewCanvas
            renderer={def.Renderer}
            config={config}
            layout={layouts.default}
            background={layouts.background}
          />
        </div>
        <aside className="flex flex-col overflow-y-auto border-l border-border/50">
          <Section title="Function">
            <fieldset disabled={readOnly} className="flex flex-col gap-3">
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
              <input
                type="checkbox"
                checked={rules.cover_slide ?? false}
                disabled={readOnly}
                onChange={(e) =>
                  commitRules({ ...rules, cover_slide: e.target.checked })
                }
                className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-foreground disabled:cursor-not-allowed"
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
          </Section>
          <Section
            title="Background"
            help="Renders behind the widget on every display. Works with 'Cover slide content' so countdowns and pre-service screens own the canvas."
          >
            <BackgroundEditor
              value={layouts.background}
              readOnly={readOnly}
              onChange={(next) =>
                commitLayouts({ ...layouts, background: next })
              }
            />
          </Section>
          <Section title="Default layout">
            <LayoutEditor
              layout={layouts.default}
              onChange={(next) =>
                commitLayouts({ ...layouts, default: next })
              }
              readOnly={readOnly}
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
              readOnly={readOnly}
            />
          </Section>
        </aside>
      </div>
    </div>
  )
}

// --- preview --------------------------------------------------------------

function PreviewCanvas({
  renderer: Renderer,
  config,
  layout,
  background,
}: {
  renderer: ReturnType<typeof widgetDef>["Renderer"]
  config: Record<string, unknown>
  layout: OverlayLayout
  background?: Background
}) {
  // Locks to 16:9 so the preview maps cleanly to a typical output
  // window. The widget wrapper marks itself as a size query container
  // so renderers' cqh-based font sizes scale with the wrapper rather
  // than depending on an external fontSize on the canvas.
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <div className="relative aspect-video w-full max-w-[720px] overflow-hidden border border-border/30 bg-black">
        {background && (
          <BackgroundLayer
            background={background}
            fill={{}}
            scale={1}
          />
        )}
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
          <Renderer config={config} style={layout.style} />
        </div>
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
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {field("x", "x")}
        {field("y", "y")}
        {field("w", "w")}
        {field("h", "h")}
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="uppercase tracking-wider">Color</span>
        <input
          type="color"
          value={color}
          disabled={readOnly}
          onChange={(e) =>
            onChange({
              ...layout,
              style: { ...layout.style, color: e.target.value },
            })
          }
          className="h-7 w-12 cursor-pointer rounded border border-border/40 bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
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
    </div>
  )
}

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
    <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
      <span className="uppercase tracking-wider">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as AnimKind)}
        className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        {ANIM_KINDS.map((a) => (
          <option key={a.kind} value={a.kind}>
            {a.label}
          </option>
        ))}
      </select>
    </label>
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
        No displays configured. Add one in Settings → Display first.
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
              <button
                type="button"
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
                  "text-[10px] uppercase tracking-wider transition-colors disabled:opacity-50",
                  has
                    ? "text-destructive hover:text-destructive/80"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {has ? "Use default" : "Override"}
              </button>
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

// Suppress lint about resolveLayout being imported but only used in
// the renderer/output pipeline elsewhere; importing it here keeps the
// module surface tight when E4 wires output rendering.
void resolveLayout

// --- background editor ----------------------------------------------------
//
// Slimmed-down counterpart to TemplatePanel's Background section. Same
// Background union, same renderer (BackgroundLayer), but the gradflow
// editor surface is preset-only here — overlays own a background only
// when they cover the slide, so per-color tuning lives in templates
// where it belongs. Operators who need fine control build a template.

const GRADFLOW_PRESETS: Record<string, GradflowConfig> = {
  Plasma: {
    color1: { r: 163, g: 106, b: 242 },
    color2: { r: 0, g: 0, b: 0 },
    color3: { r: 234, g: 130, b: 106 },
    speed: 0.6, scale: 1.2, gradientType: "silk", noise: 0.18,
  },
  Cosmic: {
    color1: { r: 85, g: 4, b: 129 },
    color2: { r: 0, g: 145, b: 255 },
    color3: { r: 0, g: 4, b: 5 },
    speed: 0.4, scale: 1.2, gradientType: "silk", noise: 0.1,
  },
  Matrix: {
    color1: { r: 34, g: 54, b: 145 },
    color2: { r: 0, g: 0, b: 0 },
    color3: { r: 147, g: 251, b: 173 },
    speed: 0.8, scale: 1, gradientType: "wave", noise: 0.1,
  },
  Inferno: {
    color1: { r: 77, g: 0, b: 0 },
    color2: { r: 0, g: 0, b: 0 },
    color3: { r: 255, g: 187, b: 0 },
    speed: 0.9, scale: 1.1, gradientType: "silk", noise: 0.18,
  },
  Mystic: {
    color1: { r: 192, g: 155, b: 197 },
    color2: { r: 0, g: 0, b: 0 },
    color3: { r: 53, g: 0, b: 97 },
    speed: 0.9, scale: 2, gradientType: "smoke", noise: 0.18,
  },
  Neon: {
    color1: { r: 102, g: 237, b: 255 },
    color2: { r: 0, g: 0, b: 0 },
    color3: { r: 0, g: 255, b: 110 },
    speed: 0.6, scale: 2, gradientType: "wave", noise: 0.18,
  },
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function BackgroundEditor({
  value,
  readOnly,
  onChange,
}: {
  value: Background | undefined
  readOnly?: boolean
  onChange: (next: Background | undefined) => void
}) {
  const type = value?.type ?? "none"
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Type</span>
      <select
        value={type}
        disabled={readOnly}
        onChange={(e) => {
          const t = e.target.value as "none" | Background["type"]
          if (t === "none") onChange(undefined)
          else if (t === "color")
            onChange({ type: "color", value: value?.type === "color" ? value.value : "#000000" })
          else if (t === "transparent") onChange({ type: "transparent" })
          else if (t === "media")
            onChange({
              type: "media",
              mediaId: value?.type === "media" ? value.mediaId : 0,
              mode: value?.type === "media" ? (value.mode ?? "cover") : "cover",
            })
          else if (t === "gradflow")
            onChange({
              type: "gradflow",
              config: value?.type === "gradflow" ? value.config : DEFAULT_GRADFLOW,
            })
        }}
        className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <option value="none">None (no background)</option>
        <option value="color">Solid color</option>
        <option value="transparent">Transparent</option>
        <option value="media">Image / Video</option>
        <option value="gradflow">Animated gradient</option>
      </select>
      {value?.type === "color" && (
        <BgColorField
          value={value.value}
          readOnly={readOnly}
          onChange={(v) => onChange({ type: "color", value: v })}
        />
      )}
      {value?.type === "transparent" && (
        <div className="text-[10px] text-muted-foreground/60">
          The canvas shows through. Useful when the overlay is meant to layer over the bound template.
        </div>
      )}
      {value?.type === "media" && (
        <BgMediaPicker
          value={value}
          readOnly={readOnly}
          onChange={(next) => onChange(next)}
        />
      )}
      {value?.type === "gradflow" && (
        <BgGradflowPresetPicker
          value={value.config}
          readOnly={readOnly}
          onChange={(cfg) => onChange({ type: "gradflow", config: cfg })}
        />
      )}
    </div>
  )
}

function BgColorField({
  value,
  readOnly,
  onChange,
}: {
  value: string
  readOnly?: boolean
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const isHex = HEX_RE.test(value)
  const pickerStart = isHex ? value : "#000000"
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={readOnly}
          className="flex h-7 items-center gap-2 rounded border border-border/40 bg-muted/30 px-1.5 text-left text-[11px] transition-colors hover:border-border focus-visible:border-border focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span
            aria-hidden
            className="size-4 shrink-0 rounded border border-border/40"
            style={{ background: value }}
          />
          <span className={cn("truncate font-mono uppercase", !isHex && "italic text-muted-foreground")}>
            {isHex ? value.toUpperCase() : value || "—"}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-auto p-2">
        <HexColorPicker color={pickerStart} onChange={(c) => onChange(c)} />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 h-6 w-full rounded border border-border/40 bg-muted/30 px-1.5 font-mono text-[11px] uppercase outline-none focus-visible:border-border focus-visible:bg-muted/50"
        />
      </PopoverContent>
    </Popover>
  )
}

function BgMediaPicker({
  value,
  readOnly,
  onChange,
}: {
  value: { type: "media"; mediaId: number; mode?: "cover" | "contain" | "loop" }
  readOnly?: boolean
  onChange: (next: { type: "media"; mediaId: number; mode?: "cover" | "contain" | "loop" }) => void
}) {
  const { data: media, isLoading } = useQuery({
    queryKey: ["media", "list"],
    queryFn: () => Media.ListMedia() as unknown as Promise<Medium[]>,
  })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const list = useMemo(() => {
    const all = media ?? []
    const q = query.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.original_filename.toLowerCase().includes(q)
    )
  }, [media, query])
  const selected = (media ?? []).find((m) => m.id === value.mediaId)
  return (
    <div className="flex flex-col gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={readOnly}
            className="flex items-center gap-2 rounded border border-border/50 bg-background px-2 py-1.5 text-left text-[11px] outline-none transition-colors hover:border-border focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded bg-muted/40 ring-1 ring-border/40">
              {selected?.type === "image" ? (
                <img src={`/media-asset/${selected.id}`} alt="" className="h-full w-full object-cover" />
              ) : selected?.type === "video" ? (
                <video src={`/media-asset/${selected.id}`} className="h-full w-full object-cover" muted preload="metadata" />
              ) : (
                <ImageIcon className="size-3 text-muted-foreground/50" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-foreground">{selected?.title || "Pick media…"}</span>
              <span className="truncate text-[10px] text-muted-foreground/60">
                {selected?.type ?? (value.mediaId === 0 ? "—" : "missing")}
              </span>
            </span>
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground/60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="flex items-center gap-1.5 border-b border-border/40 bg-muted/20 px-2 py-1.5">
            <SearchIcon className="size-3 text-muted-foreground/60" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search media…"
              className="h-6 flex-1 border-0 bg-transparent px-0 text-[11px] focus-visible:ring-0"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1.5">
            {isLoading ? (
              <div className="grid h-32 place-items-center text-[11px] text-muted-foreground/50">Loading…</div>
            ) : list.length === 0 ? (
              <div className="grid h-32 place-items-center px-3 text-center text-[11px] text-muted-foreground/50">
                {!media || media.length === 0 ? "No media yet. Import in the Media tab first." : "No matches."}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {list.map((m) => {
                  const isSelected = m.id === value.mediaId
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onChange({ type: "media", mediaId: m.id, mode: value.mode ?? "cover" })
                        setOpen(false)
                      }}
                      title={m.title}
                      className={cn(
                        "group flex flex-col overflow-hidden rounded border bg-background text-left transition-colors hover:border-border",
                        isSelected ? "border-foreground/60 ring-1 ring-foreground/30" : "border-border/40"
                      )}
                    >
                      <div className="relative aspect-video w-full overflow-hidden bg-muted/40">
                        {m.type === "image" ? (
                          <img src={`/media-asset/${m.id}`} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : m.type === "video" ? (
                          <video src={`/media-asset/${m.id}`} className="h-full w-full object-cover" muted preload="metadata" />
                        ) : (
                          <div className="grid h-full place-items-center text-muted-foreground/40">
                            <ImageIcon className="size-3" />
                          </div>
                        )}
                      </div>
                      <span className="truncate px-1 py-0.5 text-[9px] text-muted-foreground group-hover:text-foreground">
                        {m.title}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Fit mode</span>
      <select
        value={value.mode ?? "cover"}
        disabled={readOnly}
        onChange={(e) =>
          onChange({
            type: "media",
            mediaId: value.mediaId,
            mode: e.target.value as "cover" | "contain" | "loop",
          })
        }
        className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <option value="cover">Cover (fill, crop overflow)</option>
        <option value="contain">Contain (fit, letterbox)</option>
      </select>
      {value.mediaId === 0 && (
        <div className="text-[10px] text-amber-400/80">
          No media chosen — background will render black.
        </div>
      )}
    </div>
  )
}

function BgGradflowPresetPicker({
  value,
  readOnly,
  onChange,
}: {
  value: GradflowConfig
  readOnly?: boolean
  onChange: (cfg: GradflowConfig) => void
}) {
  const currentMatch = Object.entries(GRADFLOW_PRESETS).find(
    ([, cfg]) => JSON.stringify(cfg) === JSON.stringify(value)
  )?.[0]
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Preset</span>
      <select
        disabled={readOnly}
        value={currentMatch ?? ""}
        onChange={(e) => {
          const cfg = GRADFLOW_PRESETS[e.target.value]
          if (cfg) onChange({ ...cfg })
        }}
        className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        {!currentMatch && <option value="">Custom (template-only tweaks)</option>}
        {Object.keys(GRADFLOW_PRESETS).map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <div className="text-[10px] text-muted-foreground/60">
        Per-color tuning, blur, and saved user presets live in template editor. Pick a preset here, or build a full template if you need more.
      </div>
    </div>
  )
}
