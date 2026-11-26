import { useEffect, useState } from "react"
// react-qr-code ships as CJS with both default and named exports;
// Vite's interop sometimes hands the namespace object back as the
// default, so import the named binding to dodge it.
import { QRCode } from "react-qr-code"
import {
  ClockIcon,
  HourglassIcon,
  MegaphoneIcon,
  MicIcon,
  QrCodeIcon,
  TimerIcon,
  type LucideIcon,
} from "lucide-react"
import type {
  OverlayLayout,
  OverlayRules,
  WidgetKind,
} from "@/features/overlays/types"
import { Input } from "@/components/input"
import { OptionSelect } from "@/components/option-select"
import { Slider } from "@/components/slider"
import { Switch } from "@/components/switch"
import { ColorPickerButton } from "@/features/templates/editor/fields"
import { cn } from "@/lib/utils"
import { OverlayPart } from "@/features/overlays/stagger"

// A WidgetDef bundles everything the rest of the app needs to know
// about a widget kind. The runtime renderer reads `config` and
// produces visible output; the editor lets the operator change it;
// `defaultConfig`/`defaultLayout` are used when creating a fresh
// overlay so the user lands on something reasonable.
//
// `activatedAt` is the epoch-ms timestamp of when the overlay was
// toggled on in the schedule. Time-based widgets (countdown, sermon
// timer) use it to anchor their ticking. When undefined, the widget
// renders in "idle preview" mode — countdown shows its full duration
// frozen, sermon timer shows 00:00 — so library tiles aren't lying
// about state the operator hasn't created yet.
export type WidgetDef<C extends Record<string, unknown> = Record<string, unknown>> = {
  kind: WidgetKind
  label: string
  icon: LucideIcon
  defaultName: string
  defaultConfig: C
  defaultLayout: OverlayLayout
  // defaultRules supplies the cross-cutting behavior toggles that
  // make sense for this widget kind out of the box. A countdown is
  // exclusive (cover_slide: true) — it owns the screen; a clock or
  // name card layers on top of whatever's already live.
  defaultRules: OverlayRules
  Renderer: React.ComponentType<{
    config: C
    style: Record<string, unknown>
    activatedAt?: number
  }>
  // ConfigEditor is the form shown in the library editor's "Function"
  // panel and in the schedule item's quick editor. onChange merges
  // the next config snapshot wholesale.
  ConfigEditor: React.ComponentType<{
    config: C
    onChange: (next: C) => void
  }>
  // previewStates lets the editor canvas simulate a running widget at
  // interesting moments (e.g. the sermon timer's warning and over-time
  // phases) so the operator can see colours and effects before going
  // live. Each entry is how long the widget has been active.
  previewStates?: (config: C) => { label: string; elapsedMs: number }[]
}

// --- countdown ------------------------------------------------------------

// A countdown is a relative timer — the operator says "5 minutes"
// and that's what gets persisted. When the overlay is activated in
// the schedule (toggled on), the renderer anchors to activatedAt and
// counts down from `duration_seconds`. Without activatedAt (preview
// in library tile, editor canvas) the renderer shows the full
// duration frozen — honest, not pretending state.
type CountdownConfig = {
  duration_seconds: number
  label: string
}

const countdownDefault: CountdownConfig = {
  duration_seconds: 5 * 60,
  label: "Service starts in",
}

const CountdownRenderer: WidgetDef<CountdownConfig>["Renderer"] = ({
  config,
  style,
  activatedAt,
}) => {
  const now = useNow(activatedAt ? 1000 : 0)
  const remainingMs =
    activatedAt !== undefined
      ? Math.max(0, activatedAt + config.duration_seconds * 1000 - now)
      : config.duration_seconds * 1000
  const text = formatHMS(remainingMs)
  const color = (style.color as string | undefined) ?? "#ffffff"

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center"
      style={{ color, fontFamily: "system-ui, sans-serif" }}
    >
      {config.label ? (
        <div
          className="uppercase tracking-[0.2em] opacity-70"
          style={{ fontSize: "15cqh" }}
        >
          {config.label}
        </div>
      ) : null}
      <div
        className="tabular-nums font-semibold leading-none"
        style={{ fontSize: "55cqh" }}
      >
        {text}
      </div>
    </div>
  )
}

const CountdownEditor: WidgetDef<CountdownConfig>["ConfigEditor"] = ({
  config,
  onChange,
}) => {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Label">
        <Input
          value={config.label}
          onChange={(e) => onChange({ ...config, label: e.target.value })}
          placeholder="Service starts in"
          className="h-8 text-xs"
        />
      </Field>
      <DurationField
        label="Duration"
        seconds={config.duration_seconds}
        onChange={(s) => onChange({ ...config, duration_seconds: s })}
      />
    </div>
  )
}

const countdownDef: WidgetDef<CountdownConfig> = {
  kind: "countdown",
  label: "Countdown",
  icon: TimerIcon,
  defaultName: "Countdown",
  defaultConfig: countdownDefault,
  defaultLayout: {
    x: 0.5,
    y: 0.5,
    w: 0.4,
    h: 0.2,
    style: { color: "#ffffff" },
  },
  defaultRules: { cover_slide: true },
  Renderer: CountdownRenderer,
  ConfigEditor: CountdownEditor,
}

// --- clock ----------------------------------------------------------------

type ClockConfig = {
  hour12: boolean
  show_seconds: boolean
  // Text size as a percent of the default (100 = fills the box height).
  size: number
}

const ClockRenderer: WidgetDef<ClockConfig>["Renderer"] = ({
  config,
  style,
}) => {
  // Clocks always tick — they don't depend on activatedAt; the
  // operator wants real wall-clock time whenever the overlay is on.
  const now = useAlignedNow(config.show_seconds ? 1000 : 60_000)
  const color = (style.color as string | undefined) ?? "#ffffff"
  const text = formatClock(now, config.hour12, config.show_seconds)
  const scale = (config.size ?? 100) / 100
  return (
    <div
      className="flex h-full w-full items-center justify-center font-semibold leading-none whitespace-nowrap tabular-nums"
      style={{
        color,
        fontFamily: "system-ui, sans-serif",
        fontSize: fitFontSize(text, 70 * scale, 100 * scale),
      }}
    >
      {text}
    </div>
  )
}

const ClockEditor: WidgetDef<ClockConfig>["ConfigEditor"] = ({
  config,
  onChange,
}) => {
  return (
    <div className="flex flex-col gap-3">
      <Toggle
        label="12-hour"
        checked={config.hour12}
        onChange={(v) => onChange({ ...config, hour12: v })}
      />
      <Toggle
        label="Show seconds"
        checked={config.show_seconds}
        onChange={(v) => onChange({ ...config, show_seconds: v })}
      />
      <SizeField
        label="Text size"
        value={config.size ?? 100}
        min={30}
        max={140}
        onChange={(size) => onChange({ ...config, size })}
      />
    </div>
  )
}

const clockDef: WidgetDef<ClockConfig> = {
  kind: "clock",
  label: "Clock",
  icon: ClockIcon,
  defaultName: "Clock",
  defaultConfig: { hour12: true, show_seconds: false, size: 100 },
  defaultLayout: {
    x: 0.92,
    y: 0.06,
    w: 0.14,
    h: 0.08,
    style: { color: "#ffffff" },
  },
  defaultRules: { cover_slide: false },
  Renderer: ClockRenderer,
  ConfigEditor: ClockEditor,
}

// --- sermon timer ---------------------------------------------------------

// A sermon timer runs from activation against the preacher's expected
// length. It moves through three phases, each with its own colour and
// optional attention effect, so the preacher notices from the pulpit:
//
//   normal  — base colour (layout style)
//   warning — the last `warn_seconds` before the limit
//   over    — past the limit
//
// `mode` picks what the digits show: elapsed time (count up), or time
// left (count down), which flips to "+MM:SS" of overtime past the limit.
export type AttentionEffect = "none" | "pulse" | "flash" | "glow" | "shake"

export const ATTENTION_EFFECTS: { value: AttentionEffect; label: string }[] = [
  { value: "none", label: "None" },
  { value: "pulse", label: "Pulse" },
  { value: "flash", label: "Flash" },
  { value: "glow", label: "Glow" },
  { value: "shake", label: "Shake" },
]

type SermonTimerConfig = {
  target_seconds: number
  label: string
  mode: "elapsed" | "remaining"
  warn_seconds: number
  warn_color: string
  warn_effect: AttentionEffect
  over_color: string
  over_effect: AttentionEffect
  over_message: string
  backdrop: boolean
  // Current time of day alongside the timer, e.g. "10:42 AM".
  show_clock: boolean
  clock_position: "above" | "below"
  clock_hour12: boolean
  // Clock text size as a percent of the default.
  clock_size: number
}

type TimerPhase = "normal" | "warning" | "over"

function sermonPhase(
  config: SermonTimerConfig,
  elapsedMs: number,
  running: boolean
): TimerPhase {
  const limitMs = config.target_seconds * 1000
  if (!running || limitMs <= 0) return "normal"
  if (elapsedMs >= limitMs) return "over"
  if (
    config.warn_seconds > 0 &&
    elapsedMs >= limitMs - config.warn_seconds * 1000
  ) {
    return "warning"
  }
  return "normal"
}

const SermonTimerRenderer: WidgetDef<SermonTimerConfig>["Renderer"] = ({
  config,
  style,
  activatedAt,
}) => {
  const now = useNow(activatedAt ? 1000 : 0)
  const running = activatedAt !== undefined
  const elapsedMs = running ? Math.max(0, now - activatedAt) : 0
  const limitMs = config.target_seconds * 1000
  const phase = sermonPhase(config, elapsedMs, running)

  const baseColor = (style.color as string | undefined) ?? "#ffffff"
  const color =
    phase === "over"
      ? config.over_color
      : phase === "warning"
        ? config.warn_color
        : baseColor
  const effect: AttentionEffect =
    phase === "over"
      ? config.over_effect
      : phase === "warning"
        ? config.warn_effect
        : "none"

  // Count-down rounds up so the display reads 30:00 for the whole
  // first second, and never shows 00:00 while time is still left.
  const text =
    config.mode === "remaining"
      ? elapsedMs > limitMs
        ? `+${formatHMS(elapsedMs - limitMs)}`
        : formatHMS(limitMs - elapsedMs + 999)
      : formatHMS(elapsedMs)
  const showMessage = phase === "over" && !!config.over_message
  const clock = config.show_clock ? (
    <TimerClock hour12={config.clock_hour12} size={config.clock_size} />
  ) : null
  const clockAbove = config.clock_position === "above"

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col items-center justify-center transition-colors",
        effect !== "none" && `np-attn-${effect}`
      )}
      style={
        {
          color,
          "--np-attn": color,
          fontFamily: "system-ui, sans-serif",
          borderRadius: "12cqh",
          backgroundColor: config.backdrop ? "rgba(0, 0, 0, 0.65)" : undefined,
        } as React.CSSProperties
      }
    >
      {clockAbove ? clock : null}
      {config.label ? (
        <div
          className="uppercase tracking-[0.2em] opacity-70"
          style={{ fontSize: "15cqh" }}
        >
          {config.label}
        </div>
      ) : null}
      <div
        className="tabular-nums font-semibold leading-none"
        style={{ fontSize: "55cqh" }}
      >
        {text}
      </div>
      {clockAbove ? null : clock}
      {showMessage ? (
        <div
          className="font-semibold uppercase tracking-[0.1em]"
          style={{ fontSize: "15cqh" }}
        >
          {config.over_message}
        </div>
      ) : null}
    </div>
  )
}

const SermonTimerEditor: WidgetDef<SermonTimerConfig>["ConfigEditor"] = ({
  config,
  onChange,
}) => {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Label">
        <Input
          value={config.label}
          onChange={(e) => onChange({ ...config, label: e.target.value })}
          placeholder="Sermon"
          className="h-8 text-xs"
        />
      </Field>
      <DurationField
        label="Time limit"
        seconds={config.target_seconds}
        onChange={(s) => onChange({ ...config, target_seconds: s })}
      />
      <SelectField
        label="Show"
        value={config.mode}
        options={[
          { value: "remaining", label: "Time left (count down, then +overtime)" },
          { value: "elapsed", label: "Time elapsed (count up)" },
        ]}
        onChange={(mode) => onChange({ ...config, mode })}
      />
      <DurationField
        label="Warn before limit"
        seconds={config.warn_seconds}
        onChange={(s) => onChange({ ...config, warn_seconds: s })}
      />
      <div className="grid grid-cols-[auto_1fr] items-end gap-2">
        <ColorField
          label="Warning"
          value={config.warn_color}
          onChange={(warn_color) => onChange({ ...config, warn_color })}
        />
        <SelectField
          label="Warning effect"
          value={config.warn_effect}
          options={ATTENTION_EFFECTS}
          onChange={(warn_effect) => onChange({ ...config, warn_effect })}
        />
        <ColorField
          label="Over time"
          value={config.over_color}
          onChange={(over_color) => onChange({ ...config, over_color })}
        />
        <SelectField
          label="Over-time effect"
          value={config.over_effect}
          options={ATTENTION_EFFECTS}
          onChange={(over_effect) => onChange({ ...config, over_effect })}
        />
      </div>
      <Field label="Over-time message">
        <Input
          value={config.over_message}
          onChange={(e) => onChange({ ...config, over_message: e.target.value })}
          placeholder="e.g. Please wrap up"
          className="h-8 text-xs"
        />
      </Field>
      <Toggle
        label="Dark backdrop"
        checked={config.backdrop}
        onChange={(backdrop) => onChange({ ...config, backdrop })}
      />
      <Toggle
        label="Show clock"
        checked={config.show_clock}
        onChange={(show_clock) => onChange({ ...config, show_clock })}
      />
      {config.show_clock ? (
        <>
          <SelectField
            label="Clock position"
            value={config.clock_position}
            options={[
              { value: "below", label: "Below the timer" },
              { value: "above", label: "Above the timer" },
            ]}
            onChange={(clock_position) => onChange({ ...config, clock_position })}
          />
          <Toggle
            label="Clock 12-hour"
            checked={config.clock_hour12}
            onChange={(clock_hour12) => onChange({ ...config, clock_hour12 })}
          />
          <SizeField
            label="Clock size"
            value={config.clock_size}
            min={50}
            max={250}
            onChange={(clock_size) => onChange({ ...config, clock_size })}
          />
        </>
      ) : null}
    </div>
  )
}

// TimerClock is its own component so it ticks on the minute even
// while the timer itself is idle (library tiles, editor preview).
function TimerClock({ hour12, size }: { hour12: boolean; size: number }) {
  const now = useAlignedNow(60_000)
  const text = formatClock(now, hour12, false)
  return (
    <div
      className="font-medium leading-tight whitespace-nowrap tabular-nums opacity-80"
      style={{ fontSize: fitFontSize(text, 0.15 * size, 0.9 * size) }}
    >
      {text}
    </div>
  )
}

const sermonTimerDef: WidgetDef<SermonTimerConfig> = {
  kind: "sermon_timer",
  label: "Sermon timer",
  icon: HourglassIcon,
  defaultName: "Sermon timer",
  defaultConfig: {
    target_seconds: 30 * 60,
    label: "Sermon",
    mode: "remaining",
    warn_seconds: 5 * 60,
    warn_color: "#f59e0b",
    warn_effect: "pulse",
    over_color: "#ef4444",
    over_effect: "flash",
    over_message: "",
    backdrop: false,
    show_clock: false,
    clock_position: "below",
    clock_hour12: true,
    clock_size: 100,
  },
  defaultLayout: {
    x: 0.92,
    y: 0.94,
    w: 0.14,
    h: 0.08,
    style: { color: "#ffffff" },
  },
  // Sticky: the timer runs for the whole sermon, so it must survive
  // Esc and stay above the bible verses being put up.
  defaultRules: { cover_slide: false, sticky: true },
  previewStates: (config) => {
    const limit = config.target_seconds * 1000
    const warn = config.warn_seconds * 1000
    return [
      {
        label: "Running",
        elapsedMs: Math.max(0, Math.min(limit / 3, limit - warn - 60_000)),
      },
      ...(warn > 0
        ? [{ label: "Warning", elapsedMs: Math.max(0, limit - warn / 2) }]
        : []),
      { label: "Over time", elapsedMs: limit + 75_000 },
    ]
  },
  Renderer: SermonTimerRenderer,
  ConfigEditor: SermonTimerEditor,
}

// --- preacher name (entry card) -------------------------------------------

// More like a lower-third intro card than a static label: animates
// in (slide + fade) on mount, holds while the overlay is active,
// and animates out when the overlay layer removes it (handled by
// AnimatePresence in the output renderer).
type PreacherNameConfig = {
  name: string
  subtitle: string
}

const PreacherNameRenderer: WidgetDef<PreacherNameConfig>["Renderer"] = ({
  config,
  style,
}) => {
  // Whole-card motion is owned by OverlayInstance. The three visual
  // portions — card panel, name, subtitle — are each an OverlayPart:
  // when the layout sets stagger_ms, they animate in on their own
  // accord (panel → name → subtitle) and peel off in reverse when the
  // overlay leaves live. With stagger off (or in tiles/editor) the
  // parts render as plain divs and the card moves as one.
  const color = (style.color as string | undefined) ?? "#ffffff"
  const accent = (style.accent as string | undefined) ?? "#10b981"
  return (
    <div className="relative flex h-full w-full items-center">
      <OverlayPart
        style={{
          position: "absolute",
          inset: 0,
          borderLeft: `0.4cqh solid ${accent}`,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      />
      <div
        className="relative flex w-full flex-col justify-center"
        style={{
          color,
          fontFamily: "system-ui, sans-serif",
          paddingInline: "6cqh",
          paddingBlock: "8cqh",
          gap: "2cqh",
        }}
      >
        <OverlayPart
          className="truncate font-semibold leading-tight"
          style={{ fontSize: "42cqh" }}
        >
          {config.name || "Name"}
        </OverlayPart>
        {config.subtitle ? (
          <OverlayPart
            className="truncate opacity-75"
            style={{ fontSize: "20cqh", lineHeight: 1.1 }}
          >
            {config.subtitle}
          </OverlayPart>
        ) : null}
      </div>
    </div>
  )
}

const PreacherNameEditor: WidgetDef<PreacherNameConfig>["ConfigEditor"] = ({
  config,
  onChange,
}) => {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Name">
        <Input
          value={config.name}
          onChange={(e) => onChange({ ...config, name: e.target.value })}
          placeholder="Pastor John Smith"
          className="h-8 text-xs"
        />
      </Field>
      <Field label="Subtitle">
        <Input
          value={config.subtitle}
          onChange={(e) => onChange({ ...config, subtitle: e.target.value })}
          placeholder="Senior Pastor — or — performed by"
          className="h-8 text-xs"
        />
      </Field>
    </div>
  )
}

const preacherNameDef: WidgetDef<PreacherNameConfig> = {
  kind: "preacher_name",
  label: "Name card",
  icon: MicIcon,
  defaultName: "Name card",
  defaultConfig: { name: "Pastor John Smith", subtitle: "Senior Pastor" },
  defaultLayout: {
    // Lower-third intro card. Anchored to the bottom-left so it sits
    // out of the way of slide content. Box dimensions stay small —
    // the operator can grow them per-display if needed, but the
    // default never obstructs more than ~10% of the canvas height.
    x: 0.16,
    y: 0.9,
    w: 0.28,
    h: 0.08,
    // stagger_ms > 0: the card's three portions (panel, name,
    // subtitle) enter individually instead of the card moving as one.
    style: { color: "#ffffff", accent: "#10b981", entry: "slide-right", exit: "slide-right", duration_ms: 320, stagger_ms: 110 },
  },
  defaultRules: { cover_slide: false },
  Renderer: PreacherNameRenderer,
  ConfigEditor: PreacherNameEditor,
}

// --- message --------------------------------------------------------------

type MessageConfig = {
  text: string
}

const MessageRenderer: WidgetDef<MessageConfig>["Renderer"] = ({
  config,
  style,
}) => {
  const color = (style.color as string | undefined) ?? "#ffffff"
  const bg = (style.background as string | undefined) ?? "rgba(0,0,0,0.55)"
  return (
    <div
      className="flex h-full w-full items-center justify-center text-center"
      style={{
        color,
        background: bg,
        fontFamily: "system-ui, sans-serif",
        padding: "8cqh 12cqh",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div
        className="truncate font-medium"
        style={{ fontSize: "55cqh" }}
      >
        {config.text || "Message"}
      </div>
    </div>
  )
}

const MessageEditor: WidgetDef<MessageConfig>["ConfigEditor"] = ({
  config,
  onChange,
}) => {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Text">
        <Input
          value={config.text}
          onChange={(e) => onChange({ ...config, text: e.target.value })}
          placeholder="Please silence your phones"
          className="h-8 text-xs"
        />
      </Field>
    </div>
  )
}

const messageDef: WidgetDef<MessageConfig> = {
  kind: "message",
  label: "Message",
  icon: MegaphoneIcon,
  defaultName: "Message",
  defaultConfig: { text: "Please silence your phones" },
  defaultLayout: {
    x: 0.5,
    y: 0.12,
    w: 0.55,
    h: 0.1,
    style: { color: "#ffffff", background: "rgba(0,0,0,0.55)", entry: "slide-down", exit: "slide-down", duration_ms: 260 },
  },
  defaultRules: { cover_slide: false },
  Renderer: MessageRenderer,
  ConfigEditor: MessageEditor,
}

// --- qr -------------------------------------------------------------------

type QrConfig = {
  url: string
  label: string
}

const QrRenderer: WidgetDef<QrConfig>["Renderer"] = ({ config, style }) => {
  const fg = (style.color as string | undefined) ?? "#ffffff"
  const bg = (style.background as string | undefined) ?? "#000000"
  const label = config.label
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center"
      style={{
        color: fg,
        fontFamily: "system-ui, sans-serif",
        gap: "4cqh",
        padding: "4cqh",
      }}
    >
      <div className="flex-1 min-h-0 aspect-square">
        <QRCode
          value={config.url || "https://example.com"}
          fgColor={fg}
          bgColor={bg}
          // 100% inside an aspect-square wrapper gives a clean square
          // QR; the lib accepts CSS sizes via style.
          style={{ height: "100%", width: "100%" }}
        />
      </div>
      {label ? (
        <div
          className="truncate text-center uppercase tracking-wider"
          style={{ fontSize: "10cqh" }}
        >
          {label}
        </div>
      ) : null}
    </div>
  )
}

const QrEditor: WidgetDef<QrConfig>["ConfigEditor"] = ({
  config,
  onChange,
}) => {
  return (
    <div className="flex flex-col gap-3">
      <Field label="URL">
        <Input
          value={config.url}
          onChange={(e) => onChange({ ...config, url: e.target.value })}
          placeholder="https://example.com"
          className="h-8 text-xs"
          spellCheck={false}
        />
      </Field>
      <Field label="Caption">
        <Input
          value={config.label}
          onChange={(e) => onChange({ ...config, label: e.target.value })}
          placeholder="Connect with us"
          className="h-8 text-xs"
        />
      </Field>
    </div>
  )
}

const qrDef: WidgetDef<QrConfig> = {
  kind: "qr",
  label: "QR code",
  icon: QrCodeIcon,
  defaultName: "QR code",
  defaultConfig: { url: "https://example.com", label: "Connect with us" },
  defaultLayout: {
    x: 0.88,
    y: 0.82,
    w: 0.18,
    h: 0.28,
    style: { color: "#ffffff", background: "#000000", entry: "scale", exit: "scale", duration_ms: 260 },
  },
  defaultRules: { cover_slide: false },
  Renderer: QrRenderer,
  ConfigEditor: QrEditor,
}

// --- registry -------------------------------------------------------------

// The single source of truth for which widgets exist. Adding a kind
// is a new entry here plus the matching literal in types.ts.
export const WIDGETS: Record<WidgetKind, WidgetDef<any>> = {
  countdown: countdownDef,
  clock: clockDef,
  sermon_timer: sermonTimerDef,
  preacher_name: preacherNameDef,
  message: messageDef,
  qr: qrDef,
}

export function widgetDef(kind: WidgetKind): WidgetDef<any> {
  return WIDGETS[kind] ?? WIDGETS.countdown
}

// --- shared helpers -------------------------------------------------------

// useNow returns the current epoch ms, re-rendering every `intervalMs`
// while mounted. `intervalMs` of 0 disables ticking — used by the
// idle preview of countdown/sermon-timer so library tiles don't
// spin a setInterval for nothing.
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!intervalMs) return
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

// useAlignedNow re-renders exactly on each stepMs boundary of the
// computer's clock (every second, or every minute), so a clock flips
// to the new minute the moment it changes instead of drifting behind.
function useAlignedNow(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let t = 0
    const schedule = () => {
      const n = Date.now()
      t = window.setTimeout(tick, stepMs - (n % stepMs) + 5)
    }
    const tick = () => {
      setNow(Date.now())
      schedule()
    }
    setNow(Date.now())
    schedule()
    // Timers are throttled in background windows; resync on return.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      window.clearTimeout(t)
      tick()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [stepMs])
  return now
}

function formatClock(ms: number, hour12: boolean, seconds: boolean): string {
  const d = new Date(ms)
  let h = d.getHours()
  let suffix = ""
  if (hour12) {
    suffix = h >= 12 ? " PM" : " AM"
    h = h % 12 || 12
  }
  const hh = hour12 ? String(h) : pad(h)
  const base = `${hh}:${pad(d.getMinutes())}`
  return (seconds ? `${base}:${pad(d.getSeconds())}` : base) + suffix
}

// fitFontSize sizes text to `heightPct` of the box height, shrinking
// to `widthPct` of the box width when the string would overflow it.
// ~0.6em per character is a safe width for tabular digits plus AM/PM.
function fitFontSize(text: string, heightPct: number, widthPct: number): string {
  return `min(${heightPct}cqh, ${widthPct / (text.length * 0.6)}cqw)`
}

// SizeField: percent slider for text size, 100 = the widget default.
function SizeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <Field label={`${label} · ${value}%`}>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={5}
        onValueChange={(v) => onChange(v[0])}
        className="py-1.5"
      />
    </Field>
  )
}

// DurationField: integer minutes + seconds input pair. The user
// thinks in minutes ("5 minute countdown"), seconds are there for
// the edge cases (30-second prayer). Stores back to a single
// seconds total because the JSON contract is "duration in seconds."
function DurationField({
  label,
  seconds,
  onChange,
}: {
  label: string
  seconds: number
  onChange: (s: number) => void
}) {
  const minutes = Math.floor(seconds / 60)
  const remSec = seconds % 60
  return (
    <Field label={label}>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min="0"
          step="1"
          value={minutes}
          onChange={(e) => {
            const m = Math.max(0, Math.floor(Number(e.target.value) || 0))
            onChange(m * 60 + remSec)
          }}
          className="h-8 w-20 text-xs"
        />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          min
        </span>
        <Input
          type="number"
          min="0"
          max="59"
          step="1"
          value={remSec}
          onChange={(e) => {
            const s = Math.max(0, Math.min(59, Math.floor(Number(e.target.value) || 0)))
            onChange(minutes * 60 + s)
          }}
          className="h-8 w-20 text-xs"
        />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          sec
        </span>
      </div>
    </Field>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-wider">{label}</span>
      {children}
    </label>
  )
}

function SelectField<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: V
  options: { value: V; label: string }[]
  onChange: (v: V) => void
}) {
  return (
    <Field label={label}>
      <OptionSelect
        value={value}
        options={options}
        onChange={onChange}
        ariaLabel={label}
      />
    </Field>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Field label={label}>
      <ColorPickerButton value={value} onChange={onChange} className="h-8" />
    </Field>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-[11px] text-muted-foreground">
      <span className="uppercase tracking-wider">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function formatHMS(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`
  return `${pad(m)}:${pad(s)}`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
