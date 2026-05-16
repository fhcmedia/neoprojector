import { createFileRoute } from "@tanstack/react-router"
import { useState, useEffect, useMemo } from "react"
import { useTheme } from "next-themes"
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/toggle-group"
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

export const Route = createFileRoute("/_app/settings")({
  component: Settings,
})

const sections = [
  { id: "general", label: "General" },
  { id: "output", label: "Output" },
  { id: "display", label: "Display" },
  { id: "audio", label: "Audio" },
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

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  // Avoid SSR/hydration mismatch — render once mounted.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const value = mounted ? (theme ?? "system") : "system"

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => v && setTheme(v)}
      variant="outline"
      size="sm"
    >
      <ToggleGroupItem value="system" aria-label="System theme">
        <MonitorIcon className="size-3.5" />
        System
      </ToggleGroupItem>
      <ToggleGroupItem value="light" aria-label="Light theme">
        <SunIcon className="size-3.5" />
        Light
      </ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme">
        <MoonIcon className="size-3.5" />
        Dark
      </ToggleGroupItem>
    </ToggleGroup>
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
        label="Theme"
        description="Follow your OS preference or pin to a specific theme."
      >
        <ThemeToggle />
      </Row>
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
                    : `${current.label} settings will live here.`
            }
          />
          {active === "general" ? (
            <GeneralPanel />
          ) : active === "display" ? (
            <DisplaySettings />
          ) : active === "bibles" ? (
            <BiblesPanel />
          ) : (
            <Placeholder label={current.label} />
          )}
        </div>
      </section>
    </div>
  )
}
