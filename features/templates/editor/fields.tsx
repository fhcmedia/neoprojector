import { useMemo, useState } from "react"
import { HexColorPicker } from "react-colorful"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/popover"
import { Checkbox } from "@/components/checkbox"
import { OptionSelect } from "@/components/option-select"
import { cn } from "@/lib/utils"
import { FONTS } from "@/features/templates/fonts"
import type { SlotName } from "@/features/templates/types"

// ─── Editor field primitives ────────────────────────────────────────────────
// Shared by the template editor's inspector panels (and reusable by the
// overlay editor). Moved verbatim from the old /templates/$templateId
// route when editors became Show-page surfaces.

export function Section({
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

export function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
      {children}
    </span>
  )
}

export function NumberField({
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
export const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function ColorField({
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
  return (
    <div className="flex flex-col gap-0.5">
      <FieldLabel>{label}</FieldLabel>
      <ColorPickerButton value={value} readOnly={readOnly} onChange={onChange} />
    </div>
  )
}

// ColorPickerButton is the themed colour control on its own (swatch +
// hex readout opening a picker popover) for panels that lay out their
// own labels — never use a native <input type="color">.
export function ColorPickerButton({
  value,
  readOnly = false,
  onChange,
  className,
}: {
  value: string
  readOnly?: boolean
  onChange: (v: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const isHex = HEX_RE.test(value)
  const pickerStart = isHex ? value : "#ffffff"
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={readOnly}
          className={cn(
            "flex h-7 items-center gap-2 rounded border border-border/40 bg-muted/30 px-1.5 text-left text-[11px] transition-colors hover:border-border focus-visible:border-border focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60",
            className
          )}
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
  )
}

export function CheckboxField({
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
export function IconChoice<T extends string>({
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
export function ToggleButton({
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
export function WeightChoice({
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

export function FontPicker({
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

export function SlotSelect({
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
    <OptionSelect
      value={value}
      options={slots}
      disabled={readOnly}
      onChange={onChange}
      ariaLabel="Slot"
      className="h-7 border-border/40 bg-muted/30 px-1.5 text-[11px] dark:bg-muted/30"
    />
  )
}
