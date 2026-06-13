import { useMemo } from "react"
import { Switch } from "@/components/switch"
import { Input } from "@/components/input"
import { useAnimations } from "@/hooks/use-animations"
import { useVimMode } from "@/hooks/use-vim-mode"
import { useLibraryAutoCollapse } from "@/hooks/use-library-auto-collapse"
import {
  resolveServiceName,
  useServiceNameFormat,
  TOKEN_SPECS,
} from "@/hooks/use-service-name-format"
import { DisplaySettings } from "@/features/displays/display-pane"
import { RestoreDefaultsPanel } from "@/features/settings/restore-defaults"
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
import { cn } from "@/lib/utils"

// SettingsSurface renders all settings as ONE scrollable column in the
// Show pane — no sidebar, no sub-navigation, no separate page. The
// schedule, displays preview, and library stay visible around it.
// Order: General, Output, Displays, Bibles.
export function SettingsSurface({ onClose }: { onClose: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-10 px-8 py-6">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-medium tracking-tight">Settings</h1>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Close (Esc)
          </button>
        </div>
        <section className="space-y-4">
          <SectionHeader title="General" description="Look and feel." />
          <GeneralPanel />
        </section>
        <section className="space-y-4">
          <SectionHeader title="Output" description="Go Live behavior." />
          <OutputPanel />
        </section>
        <section className="space-y-4">
          <SectionHeader
            title="Displays"
            description="Configured outputs and their template bindings."
          />
          <DisplaySettings />
        </section>
        <section className="space-y-4">
          <SectionHeader
            title="Bibles"
            description="Pick which translations fill the slots in multi-translation templates."
          />
          <BiblesPanel />
        </section>
        <section className="space-y-4">
          <SectionHeader
            title="Library defaults"
            description="Built-in templates, overlays, and backgrounds you've edited. Restore returns one (or all) to its shipped state."
          />
          <RestoreDefaultsPanel />
        </section>
      </div>
    </div>
  )
}

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

function LibraryAutoCollapseToggle() {
  const { enabled, setEnabled } = useLibraryAutoCollapse()
  return (
    <Switch
      checked={enabled}
      onCheckedChange={setEnabled}
      aria-label="Toggle library auto-collapse"
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
      <Row
        label="Auto-collapse library"
        description="While presenting bible from the show pane with the Bible tab open, slide the library down to just its tabs (it's redundant then). Click any tab to bring it back."
      >
        <LibraryAutoCollapseToggle />
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

// BiblesPanel: pick primary / secondary / tertiary translations. The
// primary always renders; secondary/tertiary are optional and only
// fill their slots when the bound template has matching boxes.
function BiblesPanel() {
  const { data: bibles, isLoading } = useQuery({
    queryKey: ["bible", "list"],
    queryFn: () =>
      Bible.ListBibles() as unknown as Promise<BibleTranslation[]>,
  })
  const {
    state,
    setPrimary,
    setSecondary,
    setTertiary,
    setNextVersePreview,
  } = useBibleTranslations()

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
      <Row
        label="Next-verse preview"
        description="In the Show pane, show a dimmed preview of the verse just past the selected range so you can read ahead before advancing into it."
      >
        <Switch
          checked={state.nextVersePreview}
          onCheckedChange={setNextVersePreview}
          aria-label="Toggle next-verse preview"
        />
      </Row>
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
