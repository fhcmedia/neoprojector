import type { EngineParams } from "./engine"
import {
  type LatencyPreset,
  type TranscriptionModel,
  type TranscriptionSettings,
} from "./settings"

// Per-overlay transcription config (stored in the overlay's
// config_json). The API key + noise reduction are global (Settings →
// Transcription); everything that can sensibly differ per overlay
// lives here and is editable in the overlay editor.
export type TranscriptionConfig = {
  model: TranscriptionModel
  language: string // "" = auto-detect
  latency: LatencyPreset
  prompt: string
  max_lines: number // visible subtitle lines (1–3)
  // visual
  font_scale: number // multiplier on the base subtitle size
  align: "left" | "center" | "right"
  color: string
  background: boolean // translucent bar behind the text
  uppercase: boolean
}

export const transcriptionDefaultConfig: TranscriptionConfig = {
  model: "gpt-realtime-whisper",
  language: "",
  latency: "balanced",
  prompt: "",
  max_lines: 2,
  font_scale: 1,
  align: "center",
  color: "#ffffff",
  background: true,
  uppercase: false,
}

// mergeEngineParams combines the per-overlay config with the global
// secret/noise settings into the flat parameter set the engine needs.
// The engine derives VAD/delay timing from the latency preset.
export function mergeEngineParams(
  config: TranscriptionConfig,
  settings: TranscriptionSettings
): EngineParams {
  return {
    apiKey: settings.apiKey,
    noiseReduction: settings.noiseReduction,
    model: config.model || settings.model,
    language: config.language,
    prompt: config.prompt || settings.prompt,
    latency: config.latency || settings.latency,
  }
}
