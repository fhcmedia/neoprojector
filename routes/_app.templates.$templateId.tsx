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
  CaseSensitiveIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ImageIcon,
  ItalicIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  Layers2Icon,
  Trash2Icon,
  TypeIcon,
  TypeOutlineIcon,
  UnderlineIcon,
  XIcon,
} from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Events } from "@wailsio/runtime"
import { Service as Media } from "@/bindings/neoprojector/services/media"
import type { Medium } from "@/bindings/neoprojector/database"
import { Input } from "@/components/input"
import { Button } from "@/components/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/select"
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
  DEFAULT_GRADFLOW,
  DEFAULT_TRANSITION,
  parseTemplateBody,
  type Background,
  type Box,
  type GradflowConfig,
  type GradflowType,
  type SlotFill,
  type SlotName,
  type TemplateBody,
  type TransitionKind,
} from "@/features/templates/types"
import { ANIM_KINDS } from "@/features/animations/variants"
import { FONTS, TEMPLATE_DEFAULT_FONT } from "@/features/templates/fonts"
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

  // Drop handler: accept image / video drops on the canvas, import as
  // media, set as template background. Wails fires the native drop
  // event with absolute file paths; we filter by data-file-drop-target
  // id so the schedule editor doesn't fight us for the same payload.
  const qc = useQueryClient()
  const [bgImporting, setBgImporting] = useState(false)
  useEffect(() => {
    const off = Events.On(
      "media:files-dropped",
      async (event: { data?: { paths?: string[]; target_id?: string } }) => {
        const data = event?.data ?? {}
        if (data.target_id !== "template-bg") return
        const paths = data.paths ?? []
        if (paths.length === 0) return
        setBgImporting(true)
        try {
          const imported = (await Media.ImportFiles(paths)) as unknown as Medium[]
          qc.invalidateQueries({ queryKey: ["media", "list"] })
          const first = imported.find((m) => m.type === "image" || m.type === "video")
          if (first) {
            setBody((prev) =>
              prev
                ? {
                    ...prev,
                    background: { type: "media", mediaId: first.id, mode: "cover" },
                  }
                : prev
            )
          }
        } finally {
          setBgImporting(false)
        }
      }
    )
    return () => {
      off?.()
    }
  }, [qc])

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

  function addBox(slot: Box["slot"]) {
    if (!template || !body) return
    const isMedia = slot === "media"
    const newBox: Box = {
      slot,
      x: isMedia ? 0 : Math.round(template.viewport_w * 0.1),
      y: isMedia ? 0 : Math.round(template.viewport_h * 0.3),
      w: isMedia ? template.viewport_w : Math.round(template.viewport_w * 0.8),
      h: isMedia ? template.viewport_h : Math.round(template.viewport_h * 0.35),
      font: TEMPLATE_DEFAULT_FONT,
      fontSize: isMedia ? 40 : 80,
      fontSizeMin: 20,
      fitToBox: !isMedia,
      color: "#ffffff",
      weight: 700,
      italic: false,
      align: "center",
      vAlign: "middle",
      maxLines: 0,
      lineHeight: 1.2,
    }
    const nextIndex = body.boxes.length
    setBody((b) => (b ? { ...b, boxes: [...b.boxes, newBox] } : b))
    setSelectedIndex(nextIndex)
  }

  function deleteBox(i: number) {
    setBody((b) => {
      if (!b) return b
      return { ...b, boxes: b.boxes.filter((_, idx) => idx !== i) }
    })
    setSelectedIndex(-1)
  }

  function duplicateBox(i: number) {
    setBody((b) => {
      if (!b) return b
      const src = b.boxes[i]
      const copy: Box = { ...src, x: src.x + 20, y: src.y + 20 }
      return { ...b, boxes: [...b.boxes, copy] }
    })
    setSelectedIndex(body ? body.boxes.length : 0)
  }

  // Keyboard shortcuts: Delete = remove selected box,
  // Arrow keys = nudge 1px (10px with Shift), Ctrl+D = duplicate.
  //
  // Registered in the capture phase + stopImmediatePropagation on the
  // keys we actually handle. The global keybind hook (use-keybinds.ts)
  // also listens on window for arrow keys — without this, nudging a
  // box also fires the navigateNext/Prev handler and the live slide
  // advances in front of the audience.
  useEffect(() => {
    if (isDefault) return
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (selectedIndex < 0 || !body) return
      if (e.key === "Escape") { setSelectedIndex(-1); return }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault(); e.stopImmediatePropagation(); deleteBox(selectedIndex); return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault(); e.stopImmediatePropagation(); duplicateBox(selectedIndex); return
      }
      const step = e.shiftKey ? 10 : 1
      const box = body.boxes[selectedIndex]
      if (e.key === "ArrowLeft")  { e.preventDefault(); e.stopImmediatePropagation(); updateBox(selectedIndex, { x: box.x - step }); return }
      if (e.key === "ArrowRight") { e.preventDefault(); e.stopImmediatePropagation(); updateBox(selectedIndex, { x: box.x + step }); return }
      if (e.key === "ArrowUp")    { e.preventDefault(); e.stopImmediatePropagation(); updateBox(selectedIndex, { y: box.y - step }); return }
      if (e.key === "ArrowDown")  { e.preventDefault(); e.stopImmediatePropagation(); updateBox(selectedIndex, { y: box.y + step }); return }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, body, isDefault])

  if (isLoading || !template || !body) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/50">
        Loading template…
      </div>
    )
  }

  // Editor preview fill: start from the kind's canned sample, then
  // overlay every box's `defaultContent` so the operator sees their
  // own typed text instead of the placeholder. Live-mode preserves
  // its own priority order (live fill > defaultContent > undefined);
  // overlaying in the editor only changes what the canvas previews,
  // not what gets persisted or served at runtime.
  const baseFill = sampleFor(template.kind)
  const fill: SlotFill = { ...baseFill }
  if (body) {
    for (const b of body.boxes) {
      if (b.slot === "media") continue
      if (b.defaultContent !== undefined) {
        ;(fill as Record<string, unknown>)[b.slot] = b.defaultContent
      }
    }
  }
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
        {!isDefault && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button size="xs" variant="outline">
                  <PlusIcon />
                  Add Box
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="w-44 p-1">
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
        )}
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
          <div
            className="relative min-h-0 flex-1"
            data-file-drop-target="template-bg"
          >
            <EditorCanvas
              template={template}
              body={body}
              fill={fill}
              selectedIndex={selectedIndex}
              onSelectIndex={setSelectedIndex}
              onBoxChange={(i, patch) => updateBox(i, patch)}
              readOnly={isDefault}
            />
            {bgImporting && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-sm">
                <span className="rounded bg-background px-3 py-1.5 text-xs text-foreground ring-1 ring-border/60">
                  Importing background…
                </span>
              </div>
            )}
          </div>
        </div>

        <aside className="flex w-[300px] shrink-0 flex-col border-l border-border/50">
          {selectedBox ? (
            <PropertyPanel
              box={selectedBox}
              index={selectedIndex}
              readOnly={isDefault}
              onChange={(patch) => updateBox(selectedIndex, patch)}
              onDelete={() => deleteBox(selectedIndex)}
              onDuplicate={() => duplicateBox(selectedIndex)}
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
    <div className="flex h-full flex-col overflow-y-auto">
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

      {/* Position & Size */}
      <Section title="Position & Size">
        <Grid2>
          <NumberField label="X" value={box.x} readOnly={readOnly} onChange={(v) => onChange({ x: v })} />
          <NumberField label="Y" value={box.y} readOnly={readOnly} onChange={(v) => onChange({ y: v })} />
          <NumberField label="W" value={box.w} min={10} readOnly={readOnly} onChange={(v) => onChange({ w: v })} />
          <NumberField label="H" value={box.h} min={10} readOnly={readOnly} onChange={(v) => onChange({ h: v })} />
        </Grid2>
      </Section>

      {/* Slot */}
      <Section title="Slot">
        <SlotSelect value={box.slot} readOnly={readOnly} onChange={(slot) => onChange({ slot })} />
      </Section>

      {!isMediaSlot && (
        <>
          {/* Default content — shown in the editor preview and at
             runtime whenever the live source doesn't fill this slot.
             Live content (a bible verse, a song line) takes priority;
             this is the fallback that ships with the template. */}
          <Section title="Content">
            <TextField
              label="Default text"
              value={
                typeof box.defaultContent === "string"
                  ? box.defaultContent
                  : ""
              }
              readOnly={readOnly}
              onChange={(v) =>
                onChange({ defaultContent: v.length === 0 ? undefined : v })
              }
              placeholder="Text shown when no live content is set"
            />
          </Section>

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
              <ToggleButton aria-label="Outline" pressed={box.outline ?? false} readOnly={readOnly} onPressedChange={(v) => onChange({ outline: v })}>
                <TypeOutlineIcon className="size-3.5" />
              </ToggleButton>
            </div>
            {box.outline && (
              <Grid2>
                <ColorField
                  label="Outline color"
                  value={box.outlineColor ?? "#000000"}
                  readOnly={readOnly}
                  onChange={(v) => onChange({ outlineColor: v })}
                />
                <NumberField
                  label="Outline width"
                  value={box.outlineWidth ?? 6}
                  min={0}
                  readOnly={readOnly}
                  onChange={(v) => onChange({ outlineWidth: v })}
                />
              </Grid2>
            )}
            <NumberField
              label="Letter spacing (em)"
              value={box.letterSpacing ?? 0}
              step={0.01}
              readOnly={readOnly}
              onChange={(v) => onChange({ letterSpacing: v })}
            />
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
          <NumberField label="Padding X" value={box.paddingX ?? 0} min={0} readOnly={readOnly} onChange={(v) => onChange({ paddingX: v })} />
          <NumberField label="Padding Y" value={box.paddingY ?? 0} min={0} readOnly={readOnly} onChange={(v) => onChange({ paddingY: v })} />
        </Grid2>
        <BackdropFilterFields box={box} readOnly={readOnly} onChange={onChange} />
        <FieldLabel>CSS class</FieldLabel>
        <Input
          value={box.className ?? ""}
          readOnly={readOnly}
          onChange={(e) => onChange({ className: e.target.value || undefined })}
          placeholder="e.g. headline"
          spellCheck={false}
          className="h-7 font-mono text-[11px]"
        />
        <div className="text-[10px] text-muted-foreground/60">
          Used in template Custom CSS to target this box.
        </div>
      </Section>
    </div>
  )
}

// TemplatePanel: template-level settings. Shown when no box is selected.
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
  const bg = body.background
  const bgType = bg.type

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Background */}
      <Section title="Background">
        <FieldLabel>Type</FieldLabel>
        <select
          value={bgType}
          disabled={readOnly}
          onChange={(e) => {
            const t = e.target.value as Background["type"]
            if (t === "color")
              onChange({ background: { type: "color", value: bg.type === "color" ? bg.value : "#000000" } })
            else if (t === "transparent")
              onChange({ background: { type: "transparent" } })
            else if (t === "media")
              onChange({
                background: {
                  type: "media",
                  mediaId: bg.type === "media" ? bg.mediaId : 0,
                  mode: bg.type === "media" ? (bg.mode ?? "cover") : "cover",
                },
              })
            else if (t === "gradflow")
              onChange({
                background: {
                  type: "gradflow",
                  config: bg.type === "gradflow" ? bg.config : DEFAULT_GRADFLOW,
                },
              })
          }}
          className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <option value="color">Solid color</option>
          <option value="transparent">Transparent</option>
          <option value="media">Image / Video</option>
          <option value="gradflow">Animated gradient (Gradflow)</option>
        </select>
        {bgType === "color" && (
          <ColorField
            label="Color"
            value={(bg as { type: "color"; value: string }).value}
            readOnly={readOnly}
            onChange={(v) => onChange({ background: { type: "color", value: v } })}
          />
        )}
        {bgType === "transparent" && (
          <div className="text-[10px] text-muted-foreground/60">
            The canvas background shows through. Useful for lower-thirds overlaid on video.
          </div>
        )}
        {bgType === "media" && (
          <MediaBackgroundPicker
            value={bg as { type: "media"; mediaId: number; mode?: "cover" | "contain" | "loop" }}
            readOnly={readOnly}
            onChange={(next) => onChange({ background: next })}
          />
        )}
        {bgType === "gradflow" && (
          <GradflowEditor
            value={(bg as { type: "gradflow"; config: GradflowConfig }).config}
            readOnly={readOnly}
            onChange={(next) => onChange({ background: { type: "gradflow", config: next } })}
          />
        )}
      </Section>

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
          On: every slide in a multi-slide item (e.g. a bible verse range)
          renders at the same shrunk font — ideal for lower-thirds where a
          jumpy font would distract.
          Off (default): each slide auto-shrinks to fit its own content;
          fit-to-box boxes within a slide still share one size.
        </div>
      </Section>

      {/* Custom CSS — power-user escape hatch for animations + custom
          styling. Selectors are auto-scoped to this template via CSS
          nesting; boxes expose data-slot, data-box-index, and the
          optional className. @keyframes leak globally — prefix names
          to avoid collisions. */}
      <Section title="Custom CSS">
        <div className="text-[10px] text-muted-foreground/70">
          Power-user only. Targets DOM elements rendered by this template.
          Boxes expose <code className="font-mono text-[10px] text-muted-foreground">[data-slot]</code>,
          <code className="font-mono text-[10px] text-muted-foreground"> [data-box-index]</code>,
          and the per-box class name (set in Box Settings).
        </div>
        <textarea
          value={body.customCSS ?? ""}
          readOnly={readOnly}
          onChange={(e) => onChange({ customCSS: e.target.value })}
          rows={8}
          spellCheck={false}
          placeholder={`/* example */\n[data-slot="primary"] {\n  animation: fadeUp 600ms ease-out;\n}\n@keyframes fadeUp {\n  from { opacity: 0; transform: translateY(20px); }\n  to   { opacity: 1; transform: translateY(0); }\n}`}
          className="min-h-[140px] w-full resize-y rounded border border-border/50 bg-background px-2 py-1.5 font-mono text-[11px] leading-snug outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        />
      </Section>

      {/* Canvas info */}
      <Section title="Canvas">
        <div className="grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
          <span className="text-muted-foreground/60">Width</span>
          <span className="text-right font-mono">{body.boxes.length > 0 ? "–" : "–"}</span>
        </div>
        <div className="text-[10px] text-muted-foreground/50">
          {body.boxes.length === 0
            ? "No boxes yet — click Add Box in the header."
            : `${body.boxes.length} box${body.boxes.length !== 1 ? "es" : ""}. Click a box to inspect it.`}
        </div>
        <div className="text-[10px] text-muted-foreground/40">
          Shortcuts: ← → ↑ ↓ nudge · Shift+arrow ×10 · Del delete · Ctrl+D duplicate
        </div>
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

function TextField({
  label,
  value,
  readOnly,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  readOnly: boolean
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <FieldLabel>{label}</FieldLabel>
      <textarea
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="min-h-[60px] resize-y rounded border border-border/40 bg-muted/30 px-1.5 py-1 text-[11px] outline-none focus-visible:border-border focus-visible:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
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
  // Keep the input editable as plain text so the user can clear, type
  // a partial number ("8", "8."), or paste — without each keystroke
  // round-tripping through Number() (which turns "" into 0 and trips
  // the min clamp, killing the edit mid-flow). For every keystroke
  // that *does* parse to a finite number, fire onChange so the canvas
  // updates live (the operator was confused when changes only landed
  // after blur). Partial states ("", "-", "8.") keep the typed text
  // but don't propagate. Blur / Enter normalises the text to the
  // committed value so trailing junk gets cleaned up.
  const [text, setText] = useState(String(value))
  const editingRef = useRef(false)
  useEffect(() => {
    if (editingRef.current) return
    setText(String(value))
  }, [value])

  function clamp(n: number): number {
    return min !== undefined && n < min ? min : n
  }

  function commit() {
    editingRef.current = false
    const trimmed = text.trim()
    if (trimmed === "") {
      setText(String(value))
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setText(String(value))
      return
    }
    const clamped = clamp(parsed)
    if (clamped !== value) onChange(clamped)
    setText(String(clamped))
  }

  return (
    <label className="flex flex-col gap-0.5">
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        disabled={readOnly}
        onFocus={() => {
          editingRef.current = true
        }}
        onChange={(e) => {
          editingRef.current = true
          const next = e.target.value
          setText(next)
          const trimmed = next.trim()
          if (trimmed === "") return
          const parsed = Number(trimmed)
          if (!Number.isFinite(parsed)) return
          const clamped = clamp(parsed)
          if (clamped !== value) onChange(clamped)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commit()
            ;(e.target as HTMLInputElement).blur()
          }
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

// MediaBackgroundPicker — popover grid of every imported media item.
// Renders thumbnails (image/video poster), supports search, lets the
// user pick fit-mode (cover/contain). The chosen mediaId is what gets
// persisted on the template's background; the renderer pulls bytes via
// /media-asset/:id at render time.
function MediaBackgroundPicker({
  value,
  readOnly,
  onChange,
}: {
  value: { type: "media"; mediaId: number; mode?: "cover" | "contain" | "loop" }
  readOnly: boolean
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
                <img
                  src={`/media-asset/${selected.id}`}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : selected?.type === "video" ? (
                <video
                  src={`/media-asset/${selected.id}`}
                  className="h-full w-full object-cover"
                  muted
                  preload="metadata"
                />
              ) : (
                <ImageIcon className="size-3 text-muted-foreground/50" />
              )}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-foreground">
                {selected?.title || "Pick media…"}
              </span>
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
              <div className="grid h-32 place-items-center text-[11px] text-muted-foreground/50">
                Loading…
              </div>
            ) : list.length === 0 ? (
              <div className="grid h-32 place-items-center px-3 text-center text-[11px] text-muted-foreground/50">
                {!media || media.length === 0
                  ? "No media yet. Import in the Media tab first."
                  : "No matches."}
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
                          <img
                            src={`/media-asset/${m.id}`}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : m.type === "video" ? (
                          <video
                            src={`/media-asset/${m.id}`}
                            className="h-full w-full object-cover"
                            muted
                            preload="metadata"
                          />
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
      <FieldLabel>Fit mode</FieldLabel>
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

// GradflowEditor — per-template animated WebGL gradient. Exposes the
// library's full config (3 colors, type, speed, scale, noise) plus a
// preset menu that swaps every field in one click.
const GRADFLOW_TYPES: { value: GradflowType; label: string }[] = [
  { value: "silk", label: "Silk" },
  { value: "smoke", label: "Smoke" },
  { value: "stripe", label: "Stripe" },
  { value: "wave", label: "Wave" },
  { value: "conic", label: "Conic" },
  { value: "linear", label: "Linear" },
  { value: "animated", label: "Animated" },
]

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
  Electric: {
    color1: { r: 5, g: 65, b: 245 },
    color2: { r: 178, g: 224, b: 209 },
    color3: { r: 87, g: 229, b: 149 },
    speed: 0.9, scale: 2, gradientType: "smoke", noise: 0.18,
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
  Cyber: {
    color1: { r: 102, g: 237, b: 255 },
    color2: { r: 0, g: 0, b: 0 },
    color3: { r: 0, g: 255, b: 110 },
    speed: 0.9, scale: 2, gradientType: "stripe", noise: 0.18,
  },
  Neon: {
    color1: { r: 102, g: 237, b: 255 },
    color2: { r: 0, g: 0, b: 0 },
    color3: { r: 0, g: 255, b: 110 },
    speed: 0.6, scale: 2, gradientType: "wave", noise: 0.18,
  },
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`
}
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return { r: 0, g: 0, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
}

const GRADFLOW_USER_PRESETS_KEY = "np.gradflow.userPresets"

function loadUserPresets(): Record<string, GradflowConfig> {
  try {
    const raw = window.localStorage.getItem(GRADFLOW_USER_PRESETS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}
function saveUserPresets(map: Record<string, GradflowConfig>): void {
  try {
    window.localStorage.setItem(GRADFLOW_USER_PRESETS_KEY, JSON.stringify(map))
    window.dispatchEvent(new Event("np:gradflow-presets-changed"))
  } catch { /* quota / private-mode — non-fatal */ }
}

function GradflowEditor({
  value,
  readOnly,
  onChange,
}: {
  value: GradflowConfig
  readOnly: boolean
  onChange: (next: GradflowConfig) => void
}) {
  const [userPresets, setUserPresets] = useState<Record<string, GradflowConfig>>(() => loadUserPresets())
  const [presetName, setPresetName] = useState("")
  useEffect(() => {
    const handler = () => setUserPresets(loadUserPresets())
    window.addEventListener("np:gradflow-presets-changed", handler)
    window.addEventListener("storage", handler)
    return () => {
      window.removeEventListener("np:gradflow-presets-changed", handler)
      window.removeEventListener("storage", handler)
    }
  }, [])

  function savePreset() {
    const name = presetName.trim()
    if (!name) return
    const next = { ...userPresets, [name]: { ...value } }
    setUserPresets(next)
    saveUserPresets(next)
    setPresetName("")
  }
  function deletePreset(name: string) {
    const next = { ...userPresets }
    delete next[name]
    setUserPresets(next)
    saveUserPresets(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>Preset</FieldLabel>
      <select
        disabled={readOnly}
        value=""
        onChange={(e) => {
          const v = e.target.value
          const builtin = GRADFLOW_PRESETS[v]
          if (builtin) {
            onChange({ ...builtin })
            return
          }
          if (v.startsWith("user:")) {
            const name = v.slice(5)
            const custom = userPresets[name]
            if (custom) onChange({ ...custom })
          }
        }}
        className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        <option value="">Choose preset…</option>
        <optgroup label="Built-in">
          {Object.keys(GRADFLOW_PRESETS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </optgroup>
        {Object.keys(userPresets).length > 0 && (
          <optgroup label="Saved">
            {Object.keys(userPresets).map((k) => (
              <option key={k} value={`user:${k}`}>
                {k}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      {/* Save current as preset */}
      <div className="flex items-stretch gap-1">
        <Input
          value={presetName}
          readOnly={readOnly}
          onChange={(e) => setPresetName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              savePreset()
            }
          }}
          placeholder="Preset name"
          className="h-7 flex-1 text-[11px]"
        />
        <Button
          size="xs"
          variant="outline"
          disabled={readOnly || presetName.trim() === ""}
          onClick={savePreset}
        >
          Save
        </Button>
      </div>

      {/* Saved-preset chip list with delete */}
      {Object.keys(userPresets).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {Object.keys(userPresets).map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-full bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              <button
                type="button"
                onClick={() => onChange({ ...userPresets[k] })}
                disabled={readOnly}
                className="transition-colors hover:text-foreground disabled:cursor-not-allowed"
              >
                {k}
              </button>
              <button
                type="button"
                onClick={() => deletePreset(k)}
                disabled={readOnly}
                aria-label={`Delete preset ${k}`}
                className="text-muted-foreground/50 transition-colors hover:text-destructive disabled:cursor-not-allowed"
              >
                <XIcon className="size-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <FieldLabel>Type</FieldLabel>
      <select
        value={value.gradientType}
        disabled={readOnly}
        onChange={(e) =>
          onChange({ ...value, gradientType: e.target.value as GradflowType })
        }
        className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      >
        {GRADFLOW_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <ColorField
        label="Color 1"
        value={rgbToHex(value.color1)}
        readOnly={readOnly}
        onChange={(v) => onChange({ ...value, color1: hexToRgb(v) })}
      />
      <ColorField
        label="Color 2"
        value={rgbToHex(value.color2)}
        readOnly={readOnly}
        onChange={(v) => onChange({ ...value, color2: hexToRgb(v) })}
      />
      <ColorField
        label="Color 3"
        value={rgbToHex(value.color3)}
        readOnly={readOnly}
        onChange={(v) => onChange({ ...value, color3: hexToRgb(v) })}
      />
      <GradflowSlider
        label="Speed"
        value={value.speed}
        min={0}
        max={2}
        step={0.05}
        readOnly={readOnly}
        onChange={(n) => onChange({ ...value, speed: n })}
      />
      <GradflowSlider
        label="Scale"
        value={value.scale}
        min={0.1}
        max={4}
        step={0.05}
        readOnly={readOnly}
        onChange={(n) => onChange({ ...value, scale: n })}
      />
      <GradflowSlider
        label="Noise"
        value={value.noise}
        min={0}
        max={10}
        step={0.05}
        readOnly={readOnly}
        onChange={(n) => onChange({ ...value, noise: n })}
      />
      <GradflowSlider
        label="Blur"
        value={value.blur ?? 0}
        min={0}
        max={80}
        step={1}
        readOnly={readOnly}
        onChange={(n) =>
          onChange({ ...value, blur: n === 0 ? undefined : n })
        }
      />
    </div>
  )
}

function GradflowSlider({
  label,
  value,
  min,
  max,
  step,
  readOnly,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  readOnly: boolean
  onChange: (n: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        <span className="text-[10px] tabular-nums text-muted-foreground/70">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  )
}

// BackdropFilterFields — legibility helper. CSS backdrop-filter blurs/
// dims/desaturates whatever sits behind the box. Common combo: blur=12,
// brightness=0.6, with a translucent bgColor for a frosted-glass card.
function BackdropFilterFields({
  box,
  readOnly,
  onChange,
}: {
  box: Box
  readOnly: boolean
  onChange: (patch: Partial<Box>) => void
}) {
  const blur = box.backdropBlur ?? 0
  const brightness = box.backdropBrightness ?? 1
  const saturate = box.backdropSaturate ?? 1
  const anyOn = blur > 0 || brightness !== 1 || saturate !== 1

  return (
    <div className="flex flex-col gap-1.5 rounded border border-border/30 bg-muted/10 p-2">
      <div className="flex items-center justify-between">
        <FieldLabel>Backdrop filter</FieldLabel>
        {anyOn && (
          <button
            type="button"
            onClick={() =>
              onChange({
                backdropBlur: undefined,
                backdropBrightness: undefined,
                backdropSaturate: undefined,
              })
            }
            disabled={readOnly}
            className="text-[10px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset
          </button>
        )}
      </div>
      <div className="text-[10px] leading-snug text-muted-foreground/60">
        Blurs and tints whatever sits behind the box — makes text on a
        busy gradient or image legible. Pair with a translucent box
        background for a frosted-glass look.
      </div>
      <SliderField
        label="Blur"
        value={blur}
        min={0}
        max={48}
        step={1}
        unit="px"
        readOnly={readOnly}
        onChange={(v) => onChange({ backdropBlur: v === 0 ? undefined : v })}
      />
      <SliderField
        label="Brightness"
        value={brightness}
        min={0}
        max={2}
        step={0.05}
        unit="×"
        readOnly={readOnly}
        onChange={(v) =>
          onChange({ backdropBrightness: v === 1 ? undefined : v })
        }
      />
      <SliderField
        label="Saturation"
        value={saturate}
        min={0}
        max={3}
        step={0.05}
        unit="×"
        readOnly={readOnly}
        onChange={(v) =>
          onChange({ backdropSaturate: v === 1 ? undefined : v })
        }
      />
    </div>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  unit,
  readOnly,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  readOnly: boolean
  onChange: (n: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <FieldLabel>{label}</FieldLabel>
        <span className="text-[10px] tabular-nums text-muted-foreground/70">
          {value.toFixed(2)}
          {unit ? unit : ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  )
}

function ColorField({
  label = "Color",
  value,
  readOnly,
  onChange,
}: {
  label?: string
  value: string
  readOnly: boolean
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const isHex = HEX_RE.test(value)
  const pickerStart = isHex ? value : "#ffffff"
  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel>{label}</FieldLabel>
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

  // Group by category so the picker reads "App → Sans → Display → Serif
  // → Mono → Handwritten → System" rather than one flat dump.
  // Search filters within groups; empty groups are dropped from the
  // render so the user doesn't see an empty section header.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = new Map<string, typeof FONTS[number][]>()
    for (const f of FONTS) {
      if (q && !f.family.toLowerCase().includes(q)) continue
      const arr = out.get(f.category) ?? []
      arr.push(f)
      out.set(f.category, arr)
    }
    return out
  }, [query])
  const totalCount = useMemo(
    () => Array.from(grouped.values()).reduce((n, arr) => n + arr.length, 0),
    [grouped]
  )

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
          <div className="max-h-[320px] overflow-y-auto py-1">
            {totalCount === 0 ? (
              <div className="px-3 py-2 text-[11px] text-muted-foreground/50">
                No matches.
              </div>
            ) : (
              Array.from(grouped.entries()).map(([category, fonts]) => (
                <div key={category} className="py-1">
                  <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                    {category}
                  </div>
                  {fonts.map((f) => {
                    const active = f.family === value
                    return (
                      <button
                        key={f.family}
                        type="button"
                        onClick={() => {
                          onChange(f.family)
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
                          style={{ fontFamily: f.family }}
                        >
                          {f.family}
                        </span>
                        {active && (
                          <CheckIcon className="size-3.5 shrink-0 text-foreground" />
                        )}
                      </button>
                    )
                  })}
                </div>
              ))
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
    <Select
      value={value}
      disabled={readOnly}
      onValueChange={(v) => onChange(v as SlotName)}
    >
      <SelectTrigger className="h-7 border-border/40 bg-muted/30 px-1.5 text-[11px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {slots.map((s) => (
          <SelectItem key={s.value} value={s.value} className="text-[11px]">
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
