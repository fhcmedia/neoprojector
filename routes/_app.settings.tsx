import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { Switch } from "@/components/switch"
import { Input } from "@/components/input"
import { useAnimations } from "@/hooks/use-animations"
import { useVimMode } from "@/hooks/use-vim-mode"
import {
  resolveServiceName,
  useServiceNameFormat,
  TOKEN_SPECS,
} from "@/hooks/use-service-name-format"
import { DisplaySettings } from "@/features/displays/display-pane"
import {
  useBypassDisplayCheck,
  useSetBypassDisplayCheck,
} from "@/features/displays/api"
import { useQuery } from "@tanstack/react-query"
import { Service as Bible } from "@/bindings/neoprojector/services/bible"
import type { Bible as BibleTranslation } from "@/bindings/neoprojector/database"
import { useBibleTranslations } from "@/hooks/use-bible-translations"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu"
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/native-select"
import { useTranscriptionSettings } from "@/features/transcription/settings"
import {
  LATENCY_PRESETS,
  NOISE_REDUCTION_OPTIONS,
  TRANSCRIPTION_MODELS,
  type LatencyPreset,
  type NoiseReduction,
  type TranscriptionModel,
} from "@/features/transcription/settings"
import { TRANSCRIPTION_LANGUAGES } from "@/features/transcription/languages"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/settings")({
  component: Settings,
})

const sections = [
  { id: "general", label: "General" },
  { id: "output", label: "Output" },
  { id: "display", label: "Display" },
  { id: "audio", label: "Audio" },
  { id: "transcription", label: "Transcription" },
  { id: "bibles", label: "Bibles" },
  { id: "songs", label: "Songs" },
  { id: "hotkeys", label: "Hotkeys" },
  { id: "advanced", label: "Advanced" },
] as const

type SectionId = (typeof sections)[number]["id"]

function SectionHeader({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="border-b border-border/50 pb-4">
      <h2 className="text-sm font-medium tracking-tight">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function Row({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="space-y-0.5">
        <div className="text-xs font-medium">{label}</div>
        {description && (
          <div className="text-[11px] text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function AnimationsToggle() {
  const { enabled, setEnabled } = useAnimations()
  return (
    <Switch
      checked={enabled}
      onCheckedChange={setEnabled}
      aria-label="Toggle UI animations"
    />
  )
}

function VimModeToggle() {
  const { enabled, setEnabled } = useVimMode()
  return (
    <Switch
      checked={enabled}
      onCheckedChange={setEnabled}
      aria-label="Toggle vim navigation"
    />
  )
}

function ServiceNameFormatField() {
  const { format, setFormat } = useServiceNameFormat()
  const preview = useMemo(() => resolveServiceName(format), [format])
  return (
    <div className="space-y-2">
      <Input
        value={format}
        onChange={(e) => setFormat(e.target.value)}
        spellCheck={false}
        className="h-8 w-72 text-xs"
      />
      <div className="text-[11px] text-muted-foreground">
        Preview: <span className="font-medium text-foreground">{preview}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {TOKEN_SPECS.map((t) => (
          <button
            key={t.token}
            type="button"
            onClick={() => setFormat((format ? format + " " : "") + t.token)}
            title={`${t.label} — e.g. ${t.example}`}
            className="rounded border border-border/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            {t.token}
          </button>
        ))}
      </div>
    </div>
  )
}

function GeneralPanel() {
  return (
    <div className="divide-y divide-border/40">
      <Row
        label="UI animations"
        description="Subtle motion across the app. Disable for an instant, static interface."
      >
        <AnimationsToggle />
      </Row>
      <Row
        label="Vim navigation"
        description="Adds j/k for next/prev slide on top of the arrow keys. Esc still clears the live output either way."
      >
        <VimModeToggle />
      </Row>
      <div className="space-y-2 py-3">
        <div className="text-xs font-medium">Service name format</div>
        <div className="text-[11px] text-muted-foreground">
          Used when creating a new service. Click a token to insert it.
        </div>
        <div className="pt-1">
          <ServiceNameFormatField />
        </div>
      </div>
    </div>
  )
}

function OutputPanel() {
  const { data: bypass = false } = useBypassDisplayCheck()
  const setMut = useSetBypassDisplayCheck()

  return (
    <div className="divide-y divide-border/40">
      <Row
        label="Bypass display check"
        description="Allow Go Live even when no displays are enabled or bound to a monitor. Useful for testing on single-screen machines."
      >
        <Switch
          checked={bypass}
          onCheckedChange={(v) => setMut.mutate(v)}
          aria-label="Bypass display requirement"
        />
      </Row>
    </div>
  )
}

function TranscriptionPanel() {
  const { settings, update } = useTranscriptionSettings()
  const [showKey, setShowKey] = useState(false)
  const keySet = settings.apiKey.trim().length > 0

  return (
    <div className="divide-y divide-border/40">
      <div className="space-y-2 py-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">OpenAI API key</div>
          <span
            className={cn(
              "text-[10px] uppercase tracking-wider",
              keySet ? "text-emerald-500" : "text-muted-foreground/60"
            )}
          >
            {keySet ? "Set" : "Not set"}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Used for real-time transcription over the OpenAI realtime websocket.
          Stored locally on this machine only.
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Input
            type={showKey ? "text" : "password"}
            value={settings.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder="sk-..."
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-96 max-w-full font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setShowKey((v) => !v)}
            className="rounded-md border border-border/50 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
          >
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <Row
        label="Default model"
        description="Streaming models update the caption word-by-word; whisper-1 commits whole utterances."
      >
        <NativeSelect
          size="sm"
          value={settings.model}
          onChange={(e) =>
            update({ model: e.target.value as TranscriptionModel })
          }
          className="min-w-[260px] text-xs"
        >
          {TRANSCRIPTION_MODELS.map((m) => (
            <NativeSelectOption key={m.value} value={m.value}>
              {m.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>

      <Row
        label="Default language"
        description="Auto-detect works well, but pinning the language improves accuracy and latency."
      >
        <NativeSelect
          size="sm"
          value={settings.language}
          onChange={(e) => update({ language: e.target.value })}
          className="min-w-[200px] text-xs"
        >
          {TRANSCRIPTION_LANGUAGES.map((l) => (
            <NativeSelectOption key={l.code || "auto"} value={l.code}>
              {l.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>

      <Row
        label="Default latency"
        description="How long the model waits for a pause before finalising a line."
      >
        <NativeSelect
          size="sm"
          value={settings.latency}
          onChange={(e) =>
            update({ latency: e.target.value as LatencyPreset })
          }
          className="min-w-[200px] text-xs"
        >
          {LATENCY_PRESETS.map((p) => (
            <NativeSelectOption key={p.value} value={p.value}>
              {p.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>

      <Row
        label="Noise reduction"
        description="Server-side audio cleanup before transcription."
      >
        <NativeSelect
          size="sm"
          value={settings.noiseReduction}
          onChange={(e) =>
            update({ noiseReduction: e.target.value as NoiseReduction })
          }
          className="min-w-[220px] text-xs"
        >
          {NOISE_REDUCTION_OPTIONS.map((n) => (
            <NativeSelectOption key={n.value} value={n.value}>
              {n.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Row>

      <div className="space-y-2 py-3">
        <div className="text-xs font-medium">Vocabulary hint</div>
        <div className="text-[11px] text-muted-foreground">
          Optional. Names, places, or terms to bias the transcription toward.
        </div>
        <Input
          value={settings.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder="e.g. Pastor names, ministry terms"
          className="h-8 w-96 max-w-full text-xs"
        />
      </div>

      <p className="py-3 text-[11px] text-muted-foreground/80">
        These are defaults for new <span className="font-medium">Live captions</span>{" "}
        overlays. Language, model, latency and the on-screen look are editable
        per overlay in the overlay editor.
      </p>
    </div>
  )
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="py-3 text-[11px] text-muted-foreground">
      {label} settings will live here.
    </div>
  )
}

// BiblesPanel: pick primary / secondary / tertiary translations. The
// primary always renders; secondary/tertiary are optional and only
// fill their slots when the bound template has matching boxes.
function BiblesPanel() {
  const { data: bibles, isLoading } = useQuery({
    queryKey: ["bible", "list"],
    queryFn: () =>
      Bible.ListBibles() as unknown as Promise<BibleTranslation[]>,
  })
  const { state, setPrimary, setSecondary, setTertiary } = useBibleTranslations()

  if (isLoading) {
    return (
      <div className="py-3 text-[11px] text-muted-foreground">Loading…</div>
    )
  }
  const options = bibles ?? []
  return (
    <div className="divide-y divide-border/40">
      <TranslationRow
        label="Primary"
        description="Default for picker and the primary slot in templates."
        value={state.primary}
        options={options}
        onChange={(v) => v && setPrimary(v)}
        clearable={false}
      />
      <TranslationRow
        label="Secondary"
        description="Fills the second slot in 'Two Translations' / 'Three Translations' templates."
        value={state.secondary}
        options={options}
        onChange={setSecondary}
        clearable
      />
      <TranslationRow
        label="Tertiary"
        description="Fills the third slot in 'Three Translations' templates."
        value={state.tertiary}
        options={options}
        onChange={setTertiary}
        clearable
      />
    </div>
  )
}

function TranslationRow({
  label,
  description,
  value,
  options,
  onChange,
  clearable,
}: {
  label: string
  description: string
  value: string | null
  options: BibleTranslation[]
  onChange: (translation: string | null) => void
  clearable: boolean
}) {
  const current = options.find((b) => b.translation === value)
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <div className="space-y-0.5">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex h-8 min-w-[180px] shrink-0 items-center justify-between gap-2 rounded-md border border-border/50 px-3 text-xs transition-colors hover:bg-muted",
              current ? "text-foreground" : "text-muted-foreground/60"
            )}
          >
            <span className="truncate">
              {current ? current.name : "None"}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50">
              {current?.translation ?? ""}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={4} className="min-w-[220px]">
          {clearable && (
            <>
              <DropdownMenuItem
                onSelect={() => onChange(null)}
                className={cn(value === null && "font-medium")}
              >
                None
              </DropdownMenuItem>
              {options.length > 0 && <DropdownMenuSeparator />}
            </>
          )}
          {options.map((b) => (
            <DropdownMenuItem
              key={b.translation}
              onSelect={() => onChange(b.translation)}
              className={cn(value === b.translation && "font-medium")}
            >
              <span className="flex-1 truncate">{b.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                {b.translation}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function Settings() {
  const [active, setActive] = useState<SectionId>("general")
  const current = sections.find((s) => s.id === active)!

  return (
    <div className="grid h-full grid-cols-[200px_1fr]">
      <aside className="border-r border-border/50 px-2 py-4">
        <nav className="flex flex-col gap-px">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={
                "rounded-md px-2 py-1.5 text-left text-xs transition-colors " +
                (active === s.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")
              }
            >
              {s.label}
            </button>
          ))}
        </nav>
      </aside>
      <section className="overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <SectionHeader
            title={current.label}
            description={
              active === "general"
                ? "Look and feel."
                : active === "display"
                  ? "Configured outputs and their template bindings."
                  : active === "bibles"
                    ? "Pick which translations fill the slots in multi-translation templates."
                    : active === "transcription"
                      ? "Live captions: OpenAI key, language and latency defaults."
                      : `${current.label} settings will live here.`
            }
          />
          {active === "general" ? (
            <GeneralPanel />
          ) : active === "output" ? (
            <OutputPanel />
          ) : active === "display" ? (
            <DisplaySettings />
          ) : active === "bibles" ? (
            <BiblesPanel />
          ) : active === "transcription" ? (
            <TranscriptionPanel />
          ) : (
            <Placeholder label={current.label} />
          )}
        </div>
      </section>
    </div>
  )
}
