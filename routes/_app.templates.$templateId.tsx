import { useEffect, useMemo, useRef, useState } from "react"
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router"
import { HexColorPicker } from "react-colorful"
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignVerticalJustifyCenterIcon,
  AlignVerticalJustifyEndIcon,
  AlignVerticalJustifyStartIcon,
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ItalicIcon,
  LockIcon,
  SearchIcon,
} from "lucide-react"
import { Input } from "@/components/input"
import { Button } from "@/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/popover"
import { Checkbox } from "@/components/checkbox"
import { cn } from "@/lib/utils"
import { EditorCanvas } from "@/features/templates/editor-canvas"
import { sampleFor } from "@/features/templates/samples"
import { isDefaultTemplateId } from "@/features/templates/defaults"
import {
  DEFAULT_TRANSITION,
  parseTemplateBody,
  type Box,
  type SlotName,
  type TemplateBody,
  type TransitionKind,
} from "@/features/templates/types"
import { ANIM_KINDS } from "@/features/animations/variants"
import {
  useCreateTemplate,
  useTemplate,
  useUpdateTemplate,
} from "@/features/library/templates-api"

export const Route = createFileRoute("/_app/templates/$templateId")({
  parseParams: ({ templateId }) => ({ templateId: Number(templateId) }),
  component: TemplateEditor,
})

function TemplateEditor() {
  const { templateId } = Route.useParams()
  const navigate = useNavigate()
  const router = useRouter()
  const { data: template, isLoading } = useTemplate(templateId)
  const updateMut = useUpdateTemplate()
  const createMut = useCreateTemplate()

  const isDefault = template ? isDefaultTemplateId(template.id) : false

  // Working copy of the template body. Edits go straight here and an
  // auto-save effect debounces writes back to the DB for user
  // templates. We re-seed on template id change so navigating between
  // templates resets working state.
  const [name, setName] = useState("")
  const [body, setBody] = useState<TemplateBody | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const lastLoadedIdRef = useRef<number | null>(null)

  useEffect(() => {
    if (!template) return
    if (lastLoadedIdRef.current === template.id) return
    lastLoadedIdRef.current = template.id
    setName(template.name)
    setBody(parseTemplateBody(template.data_json))
    setSelectedIndex(-1)
  }, [template])

  // Auto-save: any time the working copy diverges from the loaded
  // template, schedule a write. Debounced to 250ms so drag updates
  // (which can fire 30+ times per second) coalesce into a single
  // round-trip when the user pauses.
  useEffect(() => {
    if (!template || !body) return
    if (isDefault) return
    if (lastLoadedIdRef.current !== template.id) return
    const live = JSON.stringify(body)
    const saved = JSON.stringify(parseTemplateBody(template.data_json))
    const trimmedName = name.trim()
    if (live === saved && trimmedName === template.name) return
    const handle = window.setTimeout(() => {
      updateMut.mutate({
        id: template.id,
        name: trimmedName || template.name,
        kind: template.kind,
        viewportW: template.viewport_w,
        viewportH: template.viewport_h,
        dataJSON: live,
      })
    }, 250)
    return () => window.clearTimeout(handle)
    // updateMut is stable; intentionally omitted to keep the effect
    // keyed purely off content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, name, template, isDefault])

  function handleBack() {
    if (router.history.canGoBack()) router.history.back()
    else navigate({ to: "/", replace: true })
  }

  function handleDuplicate() {
    if (!template) return
    // Defaults aren't in the DB — duplicating posts the default's body
    // as a fresh user-owned row. User templates use the cheaper
    // SQL-side copy via DuplicateTemplate (handled at the tile level;
    // here we hit Duplicate only from a default opened in read-only).
    createMut.mutate(
      {
        name: `${template.name} copy`,
        kind: template.kind,
        viewportW: template.viewport_w,
        viewportH: template.viewport_h,
        dataJSON: JSON.stringify(body ?? parseTemplateBody(template.data_json)),
      },
      {
        onSuccess: (copy) => {
          navigate({
            to: "/templates/$templateId",
            params: { templateId: copy.id },
            replace: true,
          })
        },
      }
    )
  }

  function updateBox(i: number, patch: Partial<Box>) {
    setBody((b) => {
      if (!b) return b
      const boxes = b.boxes.map((box, idx) =>
        idx === i ? { ...box, ...patch } : box
      )
      return { ...b, boxes }
    })
  }

  if (isLoading || !template || !body) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/50">
        Loading template…
      </div>
    )
  }

  // Sample fill keyed to the template's declared kind. The sample
  // switcher was a development affordance — users edit one template at
  // a time and the relevant sample for that kind is enough.
  const fill = sampleFor(template.kind)
  const selectedBox =
    selectedIndex >= 0 ? body.boxes[selectedIndex] : undefined

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-2">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Back"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        {isDefault ? (
          <span className="flex flex-1 items-center gap-2 truncate text-xs font-medium">
            {template.name}
            <span
              title="Default — duplicate to edit"
              className="grid size-5 place-items-center rounded text-muted-foreground/70"
            >
              <LockIcon className="size-3" />
            </span>
            <span className="rounded bg-muted/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Default
            </span>
          </span>
        ) : (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Template name"
            className="h-6 max-w-[360px] flex-1 rounded-none border-0 bg-transparent px-1 py-0 text-xs font-medium shadow-none focus-visible:bg-muted/40 focus-visible:ring-0 dark:bg-transparent"
          />
        )}
        <span className="rounded bg-muted/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {template.kind}
        </span>
        {isDefault && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="xs"
              onClick={handleDuplicate}
              disabled={createMut.isPending}
            >
              <CopyIcon />
              Duplicate to edit
            </Button>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">
          {/* The canvas inherits the app background. EditorCanvas scales
             to fit width — with the panel taking 300px on the right and
             a typical app window, that means edge-to-edge horizontally
             with empty space above/below, which is what we want. */}
          <div className="min-h-0 flex-1">
            <EditorCanvas
              template={template}
              body={body}
              fill={fill}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
              onBoxChange={(i, patch) => updateBox(i, patch)}
              readOnly={isDefault}
            />
          </div>
        </div>

        <aside className="flex w-[300px] shrink-0 flex-col border-l border-border/50">
          {selectedBox ? (
            <PropertyPanel
              box={selectedBox}
              readOnly={isDefault}
              onChange={(patch) => updateBox(selectedIndex, patch)}
            />
          ) : (
            <TemplatePanel
              body={body}
              readOnly={isDefault}
              onChange={(patch) =>
                setBody((b) => (b ? { ...b, ...patch } : b))
              }
            />
          )}
        </aside>
      </div>
    </div>
  )
}

function PropertyPanel({
  box,
  readOnly,
  onChange,
}: {
  box: Box
  readOnly: boolean
  onChange: (patch: Partial<Box>) => void
}) {
  // Media slots carry no text — typography section would be pure noise.
  // The slot picker stays so the user can convert a box to/from media.
  const isMediaSlot = box.slot === "media"

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Slot">
        <SlotSelect
          value={box.slot}
          readOnly={readOnly}
          onChange={(slot) => onChange({ slot })}
        />
      </Section>
      {!isMediaSlot && (
        <>
          <Section title="Text">
            <FontPicker
              value={box.font}
              readOnly={readOnly}
              onChange={(v) => onChange({ font: v })}
            />
            <WeightChoice
              value={box.weight}
              readOnly={readOnly}
              onChange={(v) => onChange({ weight: v })}
            />
            <ColorField
              value={box.color}
              readOnly={readOnly}
              onChange={(v) => onChange({ color: v })}
            />
            <div className="flex items-center gap-1">
              <ToggleButton
                aria-label="Italic"
                pressed={box.italic}
                readOnly={readOnly}
                onPressedChange={(v) => onChange({ italic: v })}
              >
                <ItalicIcon className="size-3.5" />
              </ToggleButton>
            </div>
          </Section>
          <Section title="Size">
            <Grid2>
              <NumberField
                label="Size"
                value={box.fontSize}
                min={1}
                readOnly={readOnly}
                onChange={(v) => onChange({ fontSize: v })}
              />
              <NumberField
                label="Min size"
                value={box.fontSizeMin}
                min={1}
                readOnly={readOnly}
                onChange={(v) => onChange({ fontSizeMin: v })}
              />
            </Grid2>
            <NumberField
              label="Line height"
              value={box.lineHeight}
              step={0.05}
              min={1}
              readOnly={readOnly}
              onChange={(v) => onChange({ lineHeight: v })}
            />
            <CheckboxField
              label="Auto-shrink to fit"
              value={box.fitToBox}
              readOnly={readOnly}
              onChange={(v) => onChange({ fitToBox: v })}
            />
          </Section>
          <Section title="Alignment">
            <IconChoice
              value={box.align}
              readOnly={readOnly}
              onChange={(v) =>
                onChange({ align: v as Box["align"] })
              }
              options={[
                {
                  value: "left",
                  icon: <AlignLeftIcon className="size-3.5" />,
                  ariaLabel: "Align left",
                },
                {
                  value: "center",
                  icon: <AlignCenterIcon className="size-3.5" />,
                  ariaLabel: "Align center",
                },
                {
                  value: "right",
                  icon: <AlignRightIcon className="size-3.5" />,
                  ariaLabel: "Align right",
                },
              ]}
            />
            <IconChoice
              value={box.vAlign}
              readOnly={readOnly}
              onChange={(v) =>
                onChange({ vAlign: v as Box["vAlign"] })
              }
              options={[
                {
                  value: "top",
                  icon: (
                    <AlignVerticalJustifyStartIcon className="size-3.5" />
                  ),
                  ariaLabel: "Align top",
                },
                {
                  value: "middle",
                  icon: (
                    <AlignVerticalJustifyCenterIcon className="size-3.5" />
                  ),
                  ariaLabel: "Align middle",
                },
                {
                  value: "bottom",
                  icon: (
                    <AlignVerticalJustifyEndIcon className="size-3.5" />
                  ),
                  ariaLabel: "Align bottom",
                },
              ]}
            />
          </Section>
        </>
      )}
    </div>
  )
}

// TemplatePanel: template-level (not box-level) settings. Shown when
// no box is selected; lets the operator set the slide transition the
// template plays when its live fill changes on the audience output.
function TemplatePanel({
  body,
  readOnly,
  onChange,
}: {
  body: TemplateBody
  readOnly: boolean
  onChange: (patch: Partial<TemplateBody>) => void
}) {
  const transition = body.transition ?? DEFAULT_TRANSITION
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Section title="Transition">
        <div className="text-[10px] text-muted-foreground/70">
          Played when the live slide changes on a display bound to this template.
        </div>
        <FieldLabel>Style</FieldLabel>
        <select
          value={transition.kind}
          disabled={readOnly}
          onChange={(e) =>
            onChange({
              transition: {
                ...transition,
                kind: e.target.value as TransitionKind,
              },
            })
          }
          className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          {ANIM_KINDS.map((a) => (
            <option key={a.kind} value={a.kind}>
              {a.label}
            </option>
          ))}
        </select>
        <NumberField
          label="Duration (ms)"
          value={transition.duration_ms}
          min={0}
          step={10}
          readOnly={readOnly}
          onChange={(v) =>
            onChange({
              transition: { ...transition, duration_ms: Math.max(0, v) },
            })
          }
        />
      </Section>
    </div>
  )
}

// ─── Property panel primitives ─────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2 border-b border-border/40 px-3 py-2.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
      {children}
    </span>
  )
}

function NumberField({
  label,
  value,
  step = 1,
  min,
  readOnly,
  onChange,
}: {
  label: string
  value: number
  step?: number
  min?: number
  readOnly: boolean
  onChange: (v: number) => void
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        disabled={readOnly}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isNaN(next)) return
          if (min !== undefined && next < min) {
            onChange(min)
            return
          }
          onChange(next)
        }}
        className="h-6 rounded border border-border/40 bg-muted/30 px-1.5 text-[11px] outline-none focus-visible:border-border focus-visible:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  )
}

// react-colorful in a popover. Values can be either a #RRGGBB hex
// or a CSS expression (var(--foreground), color-mix(...), etc — used
// by the seeded theme-aware defaults). When the value isn't a clean
// hex we display "Theme color" instead of the raw CSS, so the panel
// stays compact. Opening the picker on a theme value starts at white
// and the first click commits a real hex, overriding the theme link.
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function ColorField({
  value,
  readOnly,
  onChange,
}: {
  value: string
  readOnly: boolean
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const isHex = HEX_RE.test(value)
  const pickerStart = isHex ? value : "#ffffff"
  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel>Color</FieldLabel>
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
            <span
              className={cn(
                "truncate",
                isHex ? "font-mono uppercase" : "italic text-muted-foreground"
              )}
            >
              {isHex ? value.toUpperCase() : "Theme"}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={6}
          className="w-auto p-2"
        >
          <HexColorPicker
            color={pickerStart}
            onChange={(c) => onChange(c)}
          />
          <input
            type="text"
            value={isHex ? value : ""}
            placeholder={isHex ? undefined : "Theme color"}
            onChange={(e) => onChange(e.target.value)}
            className="mt-2 h-6 w-full rounded border border-border/40 bg-muted/30 px-1.5 font-mono text-[11px] uppercase outline-none placeholder:normal-case placeholder:text-muted-foreground/60 focus-visible:border-border focus-visible:bg-muted/50"
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

function CheckboxField({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string
  value: boolean
  readOnly: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2">
      <Checkbox
        checked={value}
        disabled={readOnly}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </label>
  )
}

// Iconified segmented control — three (or more) icon buttons in a
// strip, pressed-state filled. Used for both horizontal and vertical
// alignment.
function IconChoice<T extends string>({
  value,
  options,
  readOnly,
  onChange,
}: {
  value: T
  options: { value: T; icon: React.ReactNode; ariaLabel: string }[]
  readOnly: boolean
  onChange: (v: T) => void
}) {
  return (
    <div className="flex h-7 rounded border border-border/40 bg-muted/20 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.ariaLabel}
          aria-pressed={o.value === value}
          disabled={readOnly}
          onClick={() => onChange(o.value)}
          className={cn(
            "grid flex-1 place-items-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            o.value === value
              ? "bg-muted text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.icon}
        </button>
      ))}
    </div>
  )
}

// Single icon toggle (italic, etc) styled to match IconChoice options.
function ToggleButton({
  pressed,
  readOnly,
  onPressedChange,
  children,
  ...rest
}: {
  pressed: boolean
  readOnly: boolean
  onPressedChange: (v: boolean) => void
  children: React.ReactNode
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "disabled"
>) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={readOnly}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "grid h-7 w-8 place-items-center rounded border border-border/40 bg-muted/20 transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        pressed
          ? "bg-muted text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

// Weight presets. Five buttons covering the values we actually ship:
// 400 / 500 / 600 / 700 / 900. Heavier than 900 is exotic, lighter
// than 400 reads thin on projectors.
function WeightChoice({
  value,
  readOnly,
  onChange,
}: {
  value: number
  readOnly: boolean
  onChange: (v: number) => void
}) {
  const presets = [
    { value: 400, label: "Reg" },
    { value: 500, label: "Med" },
    { value: 600, label: "Semi" },
    { value: 700, label: "Bold" },
    { value: 900, label: "Black" },
  ]
  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel>Weight</FieldLabel>
      <div className="flex h-7 rounded border border-border/40 bg-muted/20 p-0.5">
        {presets.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={readOnly}
            onClick={() => onChange(p.value)}
            style={{ fontWeight: p.value }}
            className={cn(
              "flex-1 rounded text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              value === p.value
                ? "bg-muted text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// Fonts that are actually available without any per-template asset
// loading. Inter ships via the @import in App.css with full weight
// range; the rest are present on every macOS / Windows install we
// target, so picking any of them produces a real visual change.
const AVAILABLE_FONTS = [
  "Inter",
  "Arial",
  "Helvetica",
  "Helvetica Neue",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Impact",
  "Comic Sans MS",
]

function FontPicker({
  value,
  readOnly,
  onChange,
}: {
  value: string
  readOnly: boolean
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return AVAILABLE_FONTS
    return AVAILABLE_FONTS.filter((f) =>
      f.toLowerCase().includes(q)
    )
  }, [query])

  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel>Font</FieldLabel>
      <Popover open={open} onOpenChange={(v) => {
        setOpen(v)
        if (v) setQuery("")
      }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={readOnly}
            className="flex h-7 items-center justify-between gap-2 rounded border border-border/40 bg-muted/30 px-1.5 text-left text-[11px] transition-colors hover:border-border focus-visible:border-border focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              className="truncate"
              style={{ fontFamily: value }}
            >
              {value}
            </span>
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-[240px] p-0"
        >
          <div className="flex items-center gap-1.5 border-b border-border/40 px-2 py-1.5">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fonts…"
              className="h-5 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/40"
            />
          </div>
          <div className="max-h-[240px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground/50">
                No matches.
              </div>
            ) : (
              filtered.map((f) => {
                const active = f === value
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      onChange(f)
                      setOpen(false)
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                      active
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    <span
                      className="truncate"
                      style={{ fontFamily: f }}
                    >
                      {f}
                    </span>
                    {active && (
                      <CheckIcon className="size-3.5 shrink-0 text-foreground" />
                    )}
                  </button>
                )
              })
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function SlotSelect({
  value,
  readOnly,
  onChange,
}: {
  value: SlotName
  readOnly: boolean
  onChange: (v: SlotName) => void
}) {
  const slots: { value: SlotName; label: string }[] = [
    { value: "primary", label: "Primary" },
    { value: "secondary", label: "Secondary" },
    { value: "tertiary", label: "Tertiary" },
    { value: "caption", label: "Caption" },
    { value: "media", label: "Media" },
  ]
  return (
    <select
      value={value}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value as SlotName)}
      className="h-7 rounded border border-border/40 bg-muted/30 px-1.5 text-[11px] outline-none focus-visible:border-border disabled:cursor-not-allowed disabled:opacity-60"
    >
      {slots.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  )
}
