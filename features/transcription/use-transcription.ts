import { useEffect, useMemo, useRef, useState } from "react"
import { Events } from "@wailsio/runtime"
import { useLive } from "@/features/live/live-context"
import { parseConfig } from "@/features/overlays/types"
import {
  TRANSCRIPTION_CUE_EVENT,
  TranscriptionEngine,
  type TranscriptionCue,
} from "./engine"
import { mergeEngineParams, transcriptionDefaultConfig } from "./config"
import { useTranscriptionSettings } from "./settings"

const IDLE_CUE: TranscriptionCue = { gen: 0, status: "idle", lines: [] }

// useTranscriptionEngine runs ONCE in the operator window (mounted in
// the _app shell). It watches the live overlays for an active
// transcription overlay and, when present, opens the mic + realtime
// websocket using the global key and that overlay's config. Each cue
// is broadcast app-wide over the Wails event bus so every output
// window's renderer can mirror the subtitles. It deliberately holds NO
// React state for cues — the engine talks straight to the event bus so
// transcript updates never re-render the operator UI.
export function useTranscriptionEngine() {
  const { activeOverlays } = useLive()
  const { settings } = useTranscriptionSettings()
  const engineRef = useRef<TranscriptionEngine | null>(null)

  useEffect(() => {
    const engine = new TranscriptionEngine((c) => {
      Events.Emit(TRANSCRIPTION_CUE_EVENT, c)
    })
    engineRef.current = engine
    return () => {
      engine.stop()
      engineRef.current = null
      // Tell outputs to clear when the operator window goes away.
      Events.Emit(TRANSCRIPTION_CUE_EVENT, IDLE_CUE)
    }
  }, [])

  // The active transcription overlay (first one wins — multiple live
  // transcribers would just fight over the mic).
  const active = useMemo(
    () => activeOverlays.find((o) => o.overlayKind === "transcription") ?? null,
    [activeOverlays]
  )

  const params = useMemo(() => {
    if (!active) return null
    const config = parseConfig(active.configJSON, transcriptionDefaultConfig)
    return mergeEngineParams(config, settings)
  }, [active, settings])

  // Restart the engine whenever the effective parameters change; stop
  // it when no transcription overlay is live.
  const signature = params
    ? JSON.stringify({ p: params, id: active?.scheduleItemId })
    : null
  useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    if (params) {
      void engine.start(params)
    } else {
      engine.stop()
      Events.Emit(TRANSCRIPTION_CUE_EVENT, IDLE_CUE)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return { active: !!active }
}

// useTranscriptionCue subscribes any renderer (output window, in-app
// preview) to the broadcast cue stream. Returns the latest cue, or the
// idle cue before the first event arrives.
export function useTranscriptionCue(): TranscriptionCue {
  const [cue, setCue] = useState<TranscriptionCue>(IDLE_CUE)
  useEffect(() => {
    const off = Events.On(
      TRANSCRIPTION_CUE_EVENT,
      (e: { data?: TranscriptionCue }) => {
        if (e.data) setCue(e.data)
      }
    )
    return () => {
      off?.()
    }
  }, [])
  return cue
}
