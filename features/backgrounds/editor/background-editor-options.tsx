import { ArrowLeftIcon, RotateCcwIcon } from "lucide-react"
import { Input } from "@/components/input"
import {
  ColorField,
  FieldLabel,
  Grid2,
  NumberField,
  Section,
} from "@/features/templates/editor/fields"
import {
  GRADFLOW_TYPES,
  useBackgroundEditor,
} from "./background-editor"

// BackgroundEditorOptions renders in the LEFT (schedule) pane while
// the background-editor surface is open: identity header + every
// gradflow knob. All edits autosave (seeds shadow themselves on the
// first write) and preview live on the canvas.
export function BackgroundEditorOptions() {
  const {
    isSeed,
    isShadowed,
    isLoading,
    name,
    setName,
    config,
    setConfig,
    restoreSeed,
    onClose,
  } = useBackgroundEditor()

  if (isLoading) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground/60">
        Loading…
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
          className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Background name"
          className="h-6 flex-1 rounded-none border-0 bg-transparent px-1 py-0 text-xs font-medium shadow-none focus-visible:bg-muted/40 focus-visible:ring-0 dark:bg-transparent"
        />
        {isSeed && (
          <span className="shrink-0 rounded bg-muted/60 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {isShadowed ? "Edited" : "Default"}
          </span>
        )}
      </header>

      {isShadowed && (
        <div className="flex shrink-0 items-center border-b border-border/40 px-2 py-1.5">
          <button
            type="button"
            onClick={restoreSeed}
            className="flex h-7 items-center gap-1.5 rounded border border-border/50 px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcwIcon className="size-3" />
            Restore default
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Section title="Shader">
          <FieldLabel>Type</FieldLabel>
          <select
            value={config.type}
            onChange={(e) => setConfig({ type: e.target.value })}
            className="h-7 rounded border border-border/50 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {GRADFLOW_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Section>

        <Section title="Colors">
          <ColorField
            label="Color 1"
            value={config.color1}
            readOnly={false}
            onChange={(v) => setConfig({ color1: v })}
          />
          <ColorField
            label="Color 2"
            value={config.color2}
            readOnly={false}
            onChange={(v) => setConfig({ color2: v })}
          />
          <ColorField
            label="Color 3"
            value={config.color3}
            readOnly={false}
            onChange={(v) => setConfig({ color3: v })}
          />
        </Section>

        <Section title="Motion">
          <Grid2>
            <NumberField
              label="Speed"
              value={config.speed}
              step={0.05}
              min={0}
              readOnly={false}
              onChange={(v) => setConfig({ speed: v })}
            />
            <NumberField
              label="Scale"
              value={config.scale}
              step={0.1}
              min={0.1}
              readOnly={false}
              onChange={(v) => setConfig({ scale: v })}
            />
          </Grid2>
          <NumberField
            label="Noise"
            value={config.noise}
            step={0.01}
            min={0}
            readOnly={false}
            onChange={(v) => setConfig({ noise: v })}
          />
        </Section>
      </div>
    </div>
  )
}
