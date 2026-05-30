import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
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
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/native-select"
import {
  transcriptionDefaultConfig,
  type TranscriptionConfig,
} from "@/features/transcription/config"
import {
  LATENCY_PRESETS,
  TRANSCRIPTION_MODELS,
  type TranscriptionModel,
  type LatencyPreset,
} from "@/features/transcription/settings"
import { TRANSCRIPTION_LANGUAGES } from "@/features/transcription/languages"
import { useTranscriptionCue } from "@/features/transcription/use-transcription"

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
}

const ClockRenderer: WidgetDef<ClockConfig>["Renderer"] = ({
  config,
  style,
}) => {
  // Clocks always tick — they don't depend on activatedAt; the
  // operator wants real wall-clock time whenever the overlay is on.
  const now = useNow(config.show_seconds ? 1000 : 15000)
  const d = new Date(now)
  let h = d.getHours()
  const m = pad(d.getMinutes())
  const s = pad(d.getSeconds())
  let suffix = ""
  if (config.hour12) {
    suffix = h >= 12 ? " PM" : " AM"
    h = h % 12
    if (h === 0) h = 12
  }
  const text = config.show_seconds
    ? `${pad(h)}:${m}:${s}${suffix}`
    : `${pad(h)}:${m}${suffix}`
  const color = (style.color as string | undefined) ?? "#ffffff"
  return (
    <div
      className="flex h-full w-full items-center justify-center font-semibold leading-none tabular-nums"
      style={{ color, fontFamily: "system-ui, sans-serif", fontSize: "70cqh" }}
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
    <div className="flex flex-col gap-2">
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
    </div>
  )
}

const clockDef: WidgetDef<ClockConfig> = {
  kind: "clock",
  label: "Clock",
  icon: ClockIcon,
  defaultName: "Clock",
  defaultConfig: { hour12: true, show_seconds: false },
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

// A sermon timer counts UP from activation, with the preacher's
// expected length as a soft limit. Once elapsed exceeds `target_seconds`
// the digits flip red — visible feedback to the operator (and any
// preacher who can see the cue display) that the slot has run out.
type SermonTimerConfig = {
  target_seconds: number
  label: string
}

const SermonTimerRenderer: WidgetDef<SermonTimerConfig>["Renderer"] = ({
  config,
  style,
  activatedAt,
}) => {
  const now = useNow(activatedAt ? 1000 : 0)
  const elapsedMs =
    activatedAt !== undefined ? Math.max(0, now - activatedAt) : 0
  const overLimit =
    activatedAt !== undefined &&
    elapsedMs > config.target_seconds * 1000
  const color = overLimit
    ? "#ef4444"
    : ((style.color as string | undefined) ?? "#ffffff")
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center transition-colors"
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
        {formatHMS(elapsedMs)}
      </div>
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
  },
  defaultLayout: {
    x: 0.92,
    y: 0.94,
    w: 0.14,
    h: 0.08,
    style: { color: "#ffffff" },
  },
  defaultRules: { cover_slide: false },
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
  // Motion is owned by OverlayInstance (driven by style.entry / .exit
  // through the shared variants registry). The renderer just paints
  // the card — no per-widget motion knobs here.
  const color = (style.color as string | undefined) ?? "#ffffff"
  const accent = (style.accent as string | undefined) ?? "#10b981"
  return (
    <div className="flex h-full w-full items-center">
      <div
        className="flex w-full flex-col justify-center"
        style={{
          color,
          fontFamily: "system-ui, sans-serif",
          borderLeft: `0.4cqh solid ${accent}`,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          paddingInline: "6cqh",
          paddingBlock: "8cqh",
          gap: "2cqh",
        }}
      >
        <div
          className="truncate font-semibold leading-tight"
          style={{ fontSize: "42cqh" }}
        >
          {config.name || "Name"}
        </div>
        {config.subtitle ? (
          <div
            className="truncate opacity-75"
            style={{ fontSize: "20cqh", lineHeight: 1.1 }}
          >
            {config.subtitle}
          </div>
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
    style: { color: "#ffffff", accent: "#10b981", entry: "slide-right", exit: "slide-right", duration_ms: 320 },
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

// --- transcription --------------------------------------------------------

// A live-subtitle overlay. The single operator-side engine (mic +
// OpenAI realtime websocket) feeds transcript cues over the Wails
// event bus; this renderer mirrors them as a bottom-anchored,
// auto-scrolling caption: the newest line is bright, older lines
// half-fade as they scroll up — like broadcast subtitles.
const TRANSCRIPTION_PREVIEW: { id: number; text: string }[] = [
  { id: -2, text: "and his mercy endures forever" },
  { id: -1, text: "let everything that has breath praise the Lord" },
]

const TranscriptionRenderer: WidgetDef<TranscriptionConfig>["Renderer"] = ({
  config,
  style,
  activatedAt,
}) => {
  const cue = useTranscriptionCue()
  const maxLines = Math.max(1, Math.min(3, Math.round(config.max_lines || 2)))
  const isPreview = activatedAt === undefined

  let lines = cue.lines
  if (isPreview && lines.length === 0) lines = TRANSCRIPTION_PREVIEW
  const visible = lines.slice(-maxLines)

  const color =
    config.color || (style.color as string | undefined) || "#ffffff"
  const fontScale = config.font_scale || 1
  // Sized so two lines sit comfortably inside the caption box with room
  // to spare (no clipping). Scales with the operator's text-size knob.
  const fontSize = `${(38 / maxLines) * fontScale}cqh`
  const align = config.align ?? "center"
  const justify =
    align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center"

  const showListening = !isPreview && visible.length === 0
  const showError = !isPreview && cue.status === "error" && visible.length === 0

  return (
    <div
      className="flex h-full w-full flex-col justify-end overflow-hidden"
      style={{
        fontFamily: "system-ui, sans-serif",
        // Extra bottom padding keeps the live line off the very edge of
        // the screen so it never looks half cut-off.
        padding: "2cqh 4cqh 4cqh",
        alignItems: justify,
      }}
    >
      <div
        className="flex flex-col"
        style={{
          alignItems: justify,
          gap: "1.4cqh",
          maxWidth: "100%",
          ...(config.background
            ? {
                background: "rgba(0,0,0,0.6)",
                borderRadius: "2.5cqh",
                padding: "2cqh 3cqh",
                backdropFilter: "blur(2px)",
              }
            : {}),
        }}
      >
        {showError ? (
          <div style={{ color: "#fca5a5", fontSize: `${14 * fontScale}cqh`, textAlign: align }}>
            {cue.error ?? "Transcription error"}
          </div>
        ) : showListening ? (
          <div
            className="animate-pulse"
            style={{ color, opacity: 0.6, fontSize: `${14 * fontScale}cqh`, textAlign: align }}
          >
            Listening…
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((line, i) => {
              const newest = i === visible.length - 1
              return (
                <motion.div
                  key={line.id}
                  layout="position"
                  initial={{ opacity: 0, y: "0.4em" }}
                  animate={{ opacity: newest ? 1 : 0.4, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28, ease: "easeOut" }}
                  style={{
                    color,
                    fontSize,
                    width: "100%",
                    textAlign: align,
                    lineHeight: 1.18,
                    fontWeight: 600,
                    textShadow: config.background
                      ? "none"
                      : "0 2px 8px rgba(0,0,0,0.85)",
                    textTransform: config.uppercase ? "uppercase" : "none",
                  }}
                >
                  {line.text}
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

const TranscriptionEditor: WidgetDef<TranscriptionConfig>["ConfigEditor"] = ({
  config,
  onChange,
}) => {
  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
        Real-time transcription uses your OpenAI API key from{" "}
        <span className="font-medium text-foreground">
          Settings → Transcription
        </span>
        . Audio is captured from this machine's default microphone while the
        overlay is live.
      </p>

      <Field label="Language">
        <NativeSelect
          size="sm"
          value={config.language}
          onChange={(e) => onChange({ ...config, language: e.target.value })}
          className="w-full text-xs"
        >
          {TRANSCRIPTION_LANGUAGES.map((l) => (
            <NativeSelectOption key={l.code || "auto"} value={l.code}>
              {l.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Model">
        <NativeSelect
          size="sm"
          value={config.model}
          onChange={(e) =>
            onChange({ ...config, model: e.target.value as TranscriptionModel })
          }
          className="w-full text-xs"
        >
          {TRANSCRIPTION_MODELS.map((m) => (
            <NativeSelectOption key={m.value} value={m.value}>
              {m.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Latency">
        <NativeSelect
          size="sm"
          value={config.latency}
          onChange={(e) =>
            onChange({ ...config, latency: e.target.value as LatencyPreset })
          }
          className="w-full text-xs"
        >
          {LATENCY_PRESETS.map((p) => (
            <NativeSelectOption key={p.value} value={p.value}>
              {p.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>

      <Field label="Vocabulary hint (optional)">
        <Input
          value={config.prompt}
          onChange={(e) => onChange({ ...config, prompt: e.target.value })}
          placeholder="Names, places, terms to bias toward"
          className="h-8 text-xs"
        />
      </Field>

      <Field label="Visible lines">
        <Input
          type="number"
          min="1"
          max="3"
          step="1"
          value={config.max_lines}
          onChange={(e) =>
            onChange({
              ...config,
              max_lines: Math.max(1, Math.min(3, Math.round(Number(e.target.value) || 2))),
            })
          }
          className="h-8 w-20 text-xs"
        />
      </Field>

      <Field label="Alignment">
        <NativeSelect
          size="sm"
          value={config.align}
          onChange={(e) =>
            onChange({
              ...config,
              align: e.target.value as TranscriptionConfig["align"],
            })
          }
          className="w-full text-xs"
        >
          <NativeSelectOption value="left">Left</NativeSelectOption>
          <NativeSelectOption value="center">Center</NativeSelectOption>
          <NativeSelectOption value="right">Right</NativeSelectOption>
        </NativeSelect>
      </Field>

      <Field label="Text size">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={config.font_scale}
            onChange={(e) =>
              onChange({ ...config, font_scale: Number(e.target.value) })
            }
            className="flex-1 accent-foreground"
          />
          <span className="w-10 text-right text-[10px] tabular-nums text-muted-foreground">
            {Math.round((config.font_scale || 1) * 100)}%
          </span>
        </div>
      </Field>

      <Field label="Text color">
        <input
          type="color"
          value={config.color || "#ffffff"}
          onChange={(e) => onChange({ ...config, color: e.target.value })}
          className="h-8 w-16 cursor-pointer rounded border border-border/50 bg-transparent"
        />
      </Field>

      <Toggle
        label="Background bar"
        checked={config.background}
        onChange={(v) => onChange({ ...config, background: v })}
      />
      <Toggle
        label="Uppercase"
        checked={config.uppercase}
        onChange={(v) => onChange({ ...config, uppercase: v })}
      />
    </div>
  )
}

const transcriptionDef: WidgetDef<TranscriptionConfig> = {
  kind: "transcription",
  label: "Live captions",
  icon: MicIcon,
  defaultName: "Live captions",
  defaultConfig: transcriptionDefaultConfig,
  defaultLayout: {
    x: 0.5,
    y: 0.82,
    w: 0.9,
    h: 0.24,
    style: { color: "#ffffff", entry: "fade", duration_ms: 300 },
  },
  defaultRules: { cover_slide: false },
  Renderer: TranscriptionRenderer,
  ConfigEditor: TranscriptionEditor,
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
  transcription: transcriptionDef,
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
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-foreground"
      />
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
