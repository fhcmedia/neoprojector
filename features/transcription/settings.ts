import { useCallback, useEffect, useState } from "react"

// Realtime transcription models on OpenAI's realtime endpoint.
// gpt-realtime-whisper is the natively-streaming "Whisper realtime"
// model (transcript deltas + tunable delay); gpt-4o(-mini)-transcribe
// run with server VAD; whisper-1 is the legacy model.
export type TranscriptionModel =
  | "gpt-realtime-whisper"
  | "gpt-4o-mini-transcribe"
  | "gpt-4o-transcribe"
  | "whisper-1"

export const TRANSCRIPTION_MODELS: { value: TranscriptionModel; label: string }[] = [
  { value: "gpt-realtime-whisper", label: "Whisper realtime (streaming)" },
  { value: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe (server VAD)" },
  { value: "gpt-4o-transcribe", label: "gpt-4o-transcribe (server VAD)" },
  { value: "whisper-1", label: "whisper-1 (legacy)" },
]

// modelUsesServerVad — gpt-4o transcribe models commit audio
// automatically via server voice-activity detection. The Whisper
// models need manual commits driven by client-side silence detection
// (see the engine).
export function modelUsesServerVad(model: TranscriptionModel): boolean {
  return model === "gpt-4o-transcribe" || model === "gpt-4o-mini-transcribe"
}

// Latency presets. For Whisper realtime they map to the API's `delay`
// knob; for server-VAD models they map to turn-detection timing and
// the client silence window.
export type LatencyPreset = "low" | "balanced" | "accurate"

export const LATENCY_PRESETS: { value: LatencyPreset; label: string }[] = [
  { value: "low", label: "Low latency (snappy)" },
  { value: "balanced", label: "Balanced" },
  { value: "accurate", label: "Accurate (waits for pauses)" },
]

// Whisper-realtime `delay` value per the realtime-transcription guide
// (minimal | low | medium | high | xhigh).
export function delayForLatency(preset: LatencyPreset): string {
  switch (preset) {
    case "low":
      return "low"
    case "accurate":
      return "high"
    case "balanced":
    default:
      return "medium"
  }
}

export type VadTiming = {
  threshold: number
  prefix_padding_ms: number
  silence_duration_ms: number
}

export function vadForLatency(preset: LatencyPreset): VadTiming {
  switch (preset) {
    case "low":
      return { threshold: 0.5, prefix_padding_ms: 200, silence_duration_ms: 320 }
    case "accurate":
      return { threshold: 0.6, prefix_padding_ms: 400, silence_duration_ms: 900 }
    case "balanced":
    default:
      return { threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 550 }
  }
}

// Client-side silence window (ms) used to manually commit audio for the
// no-server-VAD (Whisper) models.
export function silenceMsForLatency(preset: LatencyPreset): number {
  switch (preset) {
    case "low":
      return 450
    case "accurate":
      return 1100
    case "balanced":
    default:
      return 750
  }
}

export type NoiseReduction = "off" | "near_field" | "far_field"

export const NOISE_REDUCTION_OPTIONS: { value: NoiseReduction; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "near_field", label: "Near field (headset / close mic)" },
  { value: "far_field", label: "Far field (room mic)" },
]

// Global transcription settings. The API key is the only true secret;
// the rest act as defaults that a per-overlay config can override. The
// engine always reads the key + noise reduction from here.
export type TranscriptionSettings = {
  apiKey: string
  model: TranscriptionModel
  language: string
  latency: LatencyPreset
  prompt: string
  noiseReduction: NoiseReduction
}

export const DEFAULT_TRANSCRIPTION_SETTINGS: TranscriptionSettings = {
  apiKey: "",
  model: "gpt-realtime-whisper",
  language: "",
  latency: "balanced",
  prompt: "",
  noiseReduction: "near_field",
}

const STORAGE_KEY = "neoprojector.transcription.settings"

export function loadTranscriptionSettings(): TranscriptionSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_TRANSCRIPTION_SETTINGS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_TRANSCRIPTION_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_TRANSCRIPTION_SETTINGS }
  }
}

function saveTranscriptionSettings(s: TranscriptionSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* quota / private mode — non-fatal */
  }
}

// useTranscriptionSettings — localStorage-backed, with same-window live
// updates broadcast through a window event so the settings page and the
// engine controller (both in the operator window) stay in sync without
// prop-drilling.
const SYNC_EVENT = "neoprojector:transcription-settings"

export function useTranscriptionSettings() {
  const [settings, setSettings] = useState<TranscriptionSettings>(() =>
    loadTranscriptionSettings()
  )

  useEffect(() => {
    const onSync = () => setSettings(loadTranscriptionSettings())
    window.addEventListener(SYNC_EVENT, onSync)
    window.addEventListener("storage", onSync)
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync)
      window.removeEventListener("storage", onSync)
    }
  }, [])

  const update = useCallback((patch: Partial<TranscriptionSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveTranscriptionSettings(next)
      window.dispatchEvent(new Event(SYNC_EVENT))
      return next
    })
  }, [])

  return { settings, update }
}
