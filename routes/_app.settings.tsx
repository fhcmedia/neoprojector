import { createFileRoute } from "@tanstack/react-router"
import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/toggle-group"

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

function GeneralPanel() {
  return (
    <div className="divide-y divide-border/40">
      <Row
        label="Theme"
        description="Follow your OS preference or pin to a specific theme."
      >
        <ThemeToggle />
      </Row>
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
                : `${current.label} settings will live here.`
            }
          />
          {active === "general" ? (
            <GeneralPanel />
          ) : (
            <Placeholder label={current.label} />
          )}
        </div>
      </section>
    </div>
  )
}
