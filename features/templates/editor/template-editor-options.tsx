import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignVerticalJustifyCenterIcon,
  AlignVerticalJustifyEndIcon,
  AlignVerticalJustifyStartIcon,
  ArrowLeftIcon,
  CaseSensitiveIcon,
  CopyIcon,
  ImageIcon,
  ItalicIcon,
  PlusIcon,
  Layers2Icon,
  Trash2Icon,
  TypeIcon,
  UnderlineIcon,
} from "lucide-react"
import { Input } from "@/components/input"
import { Button } from "@/components/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/popover"
import {
  DEFAULT_TRANSITION,
  type Box,
  type TemplateBody,
  type TransitionKind,
} from "@/features/templates/types"
import { ANIM_KINDS } from "@/features/animations/variants"
import { useTemplateEditor } from "./template-editor"
import {
  CheckboxField,
  ColorField,
  FieldLabel,
  FontPicker,
  Grid2,
  IconChoice,
  NumberField,
  Section,
  SlotSelect,
  ToggleButton,
  WeightChoice,
} from "./fields"

// TemplateEditorOptions renders in the LEFT (schedule) pane while the
// template-editor surface is open: identity header, box actions, and
// the inspector (box properties when a box is selected, template-level
// settings otherwise).
export function TemplateEditorOptions() {
  const {
    template,
    isLoading,
    isDefault,
    isShadowed,
    name,
    setName,
    body,
    setBody,
    selectedIndex,
    selectedBox,
    updateBox,
    addBox,
    deleteBox,
    duplicateBox,
    onClose,
  } = useTemplateEditor()

  if (isLoading || !template || !body) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/50">
        Loading template…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/50 px-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close editor"
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template name"
          className="h-6 flex-1 rounded-none border-0 bg-transparent px-1 py-0 text-xs font-medium shadow-none focus-visible:bg-muted/40 focus-visible:ring-0 dark:bg-transparent"
        />
        {isDefault && (
          <span className="shrink-0 rounded bg-muted/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {isShadowed ? "Edited" : "Default"}
          </span>
        )}
        <span className="shrink-0 rounded bg-muted/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {template.kind}
        </span>
      </header>

      <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1.5">
        <Popover>
          <PopoverTrigger asChild>
            <Button size="xs" variant="outline">
              <PlusIcon />
              Add Box
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} className="w-44 p-1">
            <button
              type="button"
              onClick={() => addBox("primary")}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <TypeIcon className="size-3.5 text-muted-foreground" />
              Text Box
            </button>
            <button
              type="button"
              onClick={() => addBox("media")}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            >
              <ImageIcon className="size-3.5 text-muted-foreground" />
              Media Box
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {selectedBox ? (
        <PropertyPanel
          box={selectedBox}
          index={selectedIndex}
          readOnly={false}
          onChange={(patch) => updateBox(selectedIndex, patch)}
          onDelete={() => deleteBox(selectedIndex)}
          onDuplicate={() => duplicateBox(selectedIndex)}
        />
      ) : (
        <TemplatePanel
          body={body}
          readOnly={false}
          onChange={(patch) => setBody((b) => ({ ...b, ...patch }))}
        />
      )}
    </div>
  )
}

function PropertyPanel({
  box,
  index,
  readOnly,
  onChange,
  onDelete,
  onDuplicate,
}: {
  box: Box
  index: number
  readOnly: boolean
  onChange: (patch: Partial<Box>) => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const isMediaSlot = box.slot === "media"

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Box header — label + actions */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <span className="flex-1 truncate text-[11px] font-medium text-muted-foreground">
          Box {index + 1} · {box.slot}
        </span>
        {!readOnly && (
          <>
            <button
              type="button"
              title="Duplicate box (Ctrl+D)"
              onClick={onDuplicate}
              className="grid size-6 place-items-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
            >
              <CopyIcon className="size-3" />
            </button>
            <button
              type="button"
              title="Delete box (Del)"
              onClick={onDelete}
              className="grid size-6 place-items-center rounded text-muted-foreground/60 hover:bg-destructive/15 hover:text-destructive"
            >
              <Trash2Icon className="size-3" />
            </button>
          </>
        )}
      </div>

      {/* Position/size is direct manipulation only — drag to move,
          handles to resize (resize clamps so the chosen font size
          never clips). No number fields. */}

      {/* Slot */}
      <Section title="Slot">
        <SlotSelect value={box.slot} readOnly={readOnly} onChange={(slot) => onChange({ slot })} />
      </Section>

      {!isMediaSlot && (
        <>
          {/* Typography */}
          <Section title="Text">
            <FontPicker value={box.font} readOnly={readOnly} onChange={(v) => onChange({ font: v })} />
            <WeightChoice value={box.weight} readOnly={readOnly} onChange={(v) => onChange({ weight: v })} />
            <ColorField value={box.color} readOnly={readOnly} onChange={(v) => onChange({ color: v })} />
            <div className="flex flex-wrap items-center gap-1">
              <ToggleButton aria-label="Italic" pressed={box.italic ?? false} readOnly={readOnly} onPressedChange={(v) => onChange({ italic: v })}>
                <ItalicIcon className="size-3.5" />
              </ToggleButton>
              <ToggleButton aria-label="Underline" pressed={box.underline ?? false} readOnly={readOnly} onPressedChange={(v) => onChange({ underline: v })}>
                <UnderlineIcon className="size-3.5" />
              </ToggleButton>
              <ToggleButton aria-label="Uppercase" pressed={box.uppercase ?? false} readOnly={readOnly} onPressedChange={(v) => onChange({ uppercase: v })}>
                <CaseSensitiveIcon className="size-3.5" />
              </ToggleButton>
              <ToggleButton aria-label="Text shadow" pressed={box.shadow ?? false} readOnly={readOnly} onPressedChange={(v) => onChange({ shadow: v })}>
                <Layers2Icon className="size-3.5" />
              </ToggleButton>
            </div>
            <NumberField
              label="Letter spacing (em)"
              value={box.letterSpacing ?? 0}
              step={0.01}
              readOnly={readOnly}
              onChange={(v) => onChange({ letterSpacing: v })}
            />
            <Grid2>
              <NumberField
                label="Outline"
                value={box.outlineWidth ?? 0}
                min={0}
                readOnly={readOnly}
                onChange={(v) =>
                  onChange({ outlineWidth: v <= 0 ? undefined : v })
                }
              />
              <ColorField
                label="Outline color"
                value={box.outlineColor ?? "#000000"}
                readOnly={readOnly}
                onChange={(v) => onChange({ outlineColor: v })}
              />
            </Grid2>
          </Section>

          {/* Size & fit */}
          <Section title="Size">
            <Grid2>
              <NumberField label="Font size" value={box.fontSize} min={1} readOnly={readOnly} onChange={(v) => onChange({ fontSize: v })} />
              <NumberField label="Min size" value={box.fontSizeMin} min={1} readOnly={readOnly} onChange={(v) => onChange({ fontSizeMin: v })} />
            </Grid2>
            <Grid2>
              <NumberField label="Line height" value={box.lineHeight} step={0.05} min={0.5} readOnly={readOnly} onChange={(v) => onChange({ lineHeight: v })} />
              <NumberField label="Max lines (0=∞)" value={box.maxLines} min={0} readOnly={readOnly} onChange={(v) => onChange({ maxLines: v })} />
            </Grid2>
            <CheckboxField label="Auto-shrink to fit" value={box.fitToBox} readOnly={readOnly} onChange={(v) => onChange({ fitToBox: v })} />
          </Section>

          {/* Alignment */}
          <Section title="Alignment">
            <IconChoice
              value={box.align}
              readOnly={readOnly}
              onChange={(v) => onChange({ align: v as Box["align"] })}
              options={[
                { value: "left",   icon: <AlignLeftIcon className="size-3.5" />,   ariaLabel: "Left" },
                { value: "center", icon: <AlignCenterIcon className="size-3.5" />, ariaLabel: "Center" },
                { value: "right",  icon: <AlignRightIcon className="size-3.5" />,  ariaLabel: "Right" },
              ]}
            />
            <IconChoice
              value={box.vAlign}
              readOnly={readOnly}
              onChange={(v) => onChange({ vAlign: v as Box["vAlign"] })}
              options={[
                { value: "top",    icon: <AlignVerticalJustifyStartIcon className="size-3.5" />,  ariaLabel: "Top" },
                { value: "middle", icon: <AlignVerticalJustifyCenterIcon className="size-3.5" />, ariaLabel: "Middle" },
                { value: "bottom", icon: <AlignVerticalJustifyEndIcon className="size-3.5" />,    ariaLabel: "Bottom" },
              ]}
            />
          </Section>
        </>
      )}

      {/* Appearance (all slots) */}
      <Section title="Appearance">
        <NumberField
          label="Opacity (0–1)"
          value={box.opacity ?? 1}
          step={0.05}
          min={0}
          readOnly={readOnly}
          onChange={(v) => onChange({ opacity: Math.min(1, Math.max(0, v)) })}
        />
        <ColorField
          label="Box background"
          value={box.bgColor ?? "transparent"}
          readOnly={readOnly}
          onChange={(v) => onChange({ bgColor: v === "transparent" ? undefined : v })}
        />
        <Grid2>
          <NumberField
            label="Border width"
            value={box.borderWidth ?? 0}
            min={0}
            readOnly={readOnly}
            onChange={(v) => onChange({ borderWidth: v <= 0 ? undefined : v })}
          />
          <ColorField
            label="Border color"
            value={box.borderColor ?? "#ffffff"}
            readOnly={readOnly}
            onChange={(v) => onChange({ borderColor: v })}
          />
        </Grid2>
        <Grid2>
          <NumberField label="Padding X" value={box.paddingX ?? 0} min={0} readOnly={readOnly} onChange={(v) => onChange({ paddingX: v })} />
          <NumberField label="Padding Y" value={box.paddingY ?? 0} min={0} readOnly={readOnly} onChange={(v) => onChange({ paddingY: v })} />
        </Grid2>
      </Section>
    </div>
  )
}

// TemplatePanel: template-level settings. Shown when no box is selected.
// No background section — templates are text and always render
// transparent; the z0 background/media channel owns the pixels behind
// them.
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Transition */}
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
              transition: { ...transition, kind: e.target.value as TransitionKind },
            })
          }
          className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          {ANIM_KINDS.map((a) => (
            <option key={a.kind} value={a.kind}>{a.label}</option>
          ))}
        </select>
        <NumberField
          label="Duration (ms)"
          value={transition.duration_ms}
          min={0}
          step={10}
          readOnly={readOnly}
          onChange={(v) =>
            onChange({ transition: { ...transition, duration_ms: Math.max(0, v) } })
          }
        />
      </Section>

      {/* Cross-slide uniform sizing */}
      <Section title="Sizing">
        <CheckboxField
          label="Uniform font size across slides"
          value={body.crossSlideUniform === true}
          readOnly={readOnly}
          onChange={(v) => onChange({ crossSlideUniform: v })}
        />
        <div className="text-[10px] text-muted-foreground/70">
          On (default): every slide in a multi-slide item (e.g. a bible
          verse range) renders at the same shrunk font, computed before it
          reaches the display — no jump as the operator advances.
          Off: each slide auto-shrinks to fit its own content (larger but
          jumpy); fit-to-box boxes within a slide still share one size.
        </div>
      </Section>

      {/* Canvas info */}
      <Section title="Canvas">
        <div className="text-[10px] text-muted-foreground/50">
          {body.boxes.length === 0
            ? "No boxes yet — click Add Box above."
            : `${body.boxes.length} box${body.boxes.length !== 1 ? "es" : ""}. Click a box on the canvas to inspect it.`}
        </div>
        <div className="text-[10px] text-muted-foreground/40">
          Shortcuts: ← → ↑ ↓ nudge · Shift+arrow ×10 · Del delete · Ctrl+D duplicate
        </div>
      </Section>
    </div>
  )
}
