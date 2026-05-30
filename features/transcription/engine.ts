import {
  delayForLatency,
  modelUsesServerVad,
  silenceMsForLatency,
  vadForLatency,
  type LatencyPreset,
  type NoiseReduction,
  type TranscriptionModel,
} from "./settings"

// Cross-window event carrying the current subtitle state. The operator
// window runs the single mic+websocket engine and emits this; every
// output window (and the in-app preview) listens and renders it.
export const TRANSCRIPTION_CUE_EVENT = "transcription:cue"

export type TranscriptionStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "error"

export type TranscriptionLine = { id: number; text: string }

export type TranscriptionCue = {
  gen: number
  status: TranscriptionStatus
  lines: TranscriptionLine[]
  error?: string
}

export type EngineParams = {
  apiKey: string
  model: TranscriptionModel
  language: string // "" = auto-detect
  prompt: string
  latency: LatencyPreset
  noiseReduction: NoiseReduction
}

// OpenAI realtime transcription endpoint. Browser WebSockets can't set
// Authorization headers, so the key travels as a subprotocol (the
// documented browser path). Acceptable here: this is a local desktop
// app and the key never leaves the operator's machine.
const REALTIME_URL = "wss://api.openai.com/v1/realtime?intent=transcription"
const TARGET_SAMPLE_RATE = 24000
const MAX_LINES = 4
// RMS above this counts as speech for the client-side silence detector
// (manual-commit models only).
const SPEECH_RMS = 0.012
// Force a commit if speech runs this long without a natural pause, so
// the buffer can't grow unbounded.
const MAX_UTTERANCE_MS = 9000

type CueListener = (cue: TranscriptionCue) => void

// TranscriptionEngine owns one microphone capture + one realtime
// websocket. Call start() to begin, stop() to tear everything down.
// It is framework-agnostic; the React controller hook wires its cues
// onto the Wails event bus.
export class TranscriptionEngine {
  private gen = 0
  private listener: CueListener
  private status: TranscriptionStatus = "idle"
  private error?: string

  private ws: WebSocket | null = null
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null

  private finals: TranscriptionLine[] = []
  private partialId: number | null = null
  private partialText = ""
  private seq = 0
  private running = false

  // Cue emission is throttled: transcript deltas can arrive many times
  // a second, and each cue fans out over the Wails event bus to every
  // window. Coalescing to ~8/s keeps the subtitle smooth without
  // flooding IPC / re-rendering every overlay instance per word.
  private emitTimer: number | null = null
  private lastEmitTs = 0

  // Manual-commit (no server VAD) silence tracking.
  private manualCommit = false
  private silenceMs = 700
  private hadSpeech = false
  private lastVoiceTs = 0
  private utteranceStartTs = 0

  constructor(listener: CueListener) {
    this.listener = listener
  }

  async start(params: EngineParams) {
    this.stop()
    this.running = true
    this.gen += 1
    this.finals = []
    this.partialId = null
    this.partialText = ""
    this.manualCommit = !modelUsesServerVad(params.model)
    this.silenceMs = silenceMsForLatency(params.latency)
    this.hadSpeech = false

    if (!params.apiKey) {
      this.fail("No OpenAI API key set (Settings → Transcription).")
      return
    }
    this.setStatus("connecting")

    try {
      await this.openMic(params)
    } catch (e) {
      this.fail(
        e instanceof Error
          ? `Microphone unavailable: ${e.message}`
          : "Microphone unavailable."
      )
      return
    }

    try {
      this.openSocket(params)
    } catch (e) {
      this.fail(
        e instanceof Error ? `Connection failed: ${e.message}` : "Connection failed."
      )
    }
  }

  stop() {
    this.running = false
    if (this.emitTimer !== null) {
      window.clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    if (this.processor) {
      this.processor.onaudioprocess = null
      try {
        this.processor.disconnect()
      } catch {
        /* noop */
      }
      this.processor = null
    }
    if (this.source) {
      try {
        this.source.disconnect()
      } catch {
        /* noop */
      }
      this.source = null
    }
    if (this.sink) {
      try {
        this.sink.disconnect()
      } catch {
        /* noop */
      }
      this.sink = null
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {})
      this.ctx = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = null
    }
    if (this.ws) {
      try {
        this.ws.onclose = null
        this.ws.onerror = null
        this.ws.onmessage = null
        this.ws.close()
      } catch {
        /* noop */
      }
      this.ws = null
    }
    if (this.status !== "idle") {
      this.setStatus("idle")
    }
  }

  private async openMic(params: EngineParams) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: params.noiseReduction !== "off",
        autoGainControl: true,
      },
      video: false,
    })
    this.stream = stream

    const Ctx: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext
    const ctx = new Ctx({ sampleRate: TARGET_SAMPLE_RATE })
    this.ctx = ctx
    if (ctx.state === "suspended") await ctx.resume().catch(() => {})

    const source = ctx.createMediaStreamSource(stream)
    this.source = source
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    this.processor = processor
    // A muted sink keeps the ScriptProcessor's audio graph "running"
    // (Chromium only fires onaudioprocess for connected nodes) without
    // echoing the mic to the operator's speakers.
    const sink = ctx.createGain()
    sink.gain.value = 0
    this.sink = sink

    const inRate = ctx.sampleRate
    processor.onaudioprocess = (ev) => {
      if (!this.running) return
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      const input = ev.inputBuffer.getChannelData(0)
      const pcm = floatToPcm16(input, inRate, TARGET_SAMPLE_RATE)
      if (pcm.byteLength === 0) return
      ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64FromBytes(new Uint8Array(pcm.buffer)),
        })
      )
      if (this.manualCommit) this.trackSilence(input, ws)
    }

    source.connect(processor)
    processor.connect(sink)
    sink.connect(ctx.destination)
  }

  // trackSilence drives manual commits for models without server VAD:
  // once speech has been heard and the level drops for `silenceMs`, we
  // commit the buffer so the model transcribes the utterance.
  private trackSilence(frame: Float32Array, ws: WebSocket) {
    const now = Date.now()
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)
    if (rms >= SPEECH_RMS) {
      if (!this.hadSpeech) this.utteranceStartTs = now
      this.hadSpeech = true
      this.lastVoiceTs = now
      return
    }
    if (!this.hadSpeech) return
    const longEnough = now - this.utteranceStartTs > MAX_UTTERANCE_MS
    if (now - this.lastVoiceTs > this.silenceMs || longEnough) {
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }))
      this.hadSpeech = false
    }
  }

  private openSocket(params: EngineParams) {
    const ws = new WebSocket(REALTIME_URL, [
      "realtime",
      `openai-insecure-api-key.${params.apiKey}`,
    ])
    this.ws = ws

    ws.onopen = () => {
      if (!this.running) return
      const transcription: Record<string, unknown> = { model: params.model }
      if (params.language) transcription.language = params.language
      // Whisper realtime exposes a `delay` knob; gpt-4o transcribe does
      // not. prompt steering isn't supported on whisper-realtime.
      if (params.model === "gpt-realtime-whisper") {
        transcription.delay = delayForLatency(params.latency)
      } else if (params.prompt) {
        transcription.prompt = params.prompt
      }

      const input: Record<string, unknown> = {
        format: { type: "audio/pcm", rate: TARGET_SAMPLE_RATE },
        transcription,
      }
      if (this.manualCommit) {
        input.turn_detection = null
      } else {
        const vad = vadForLatency(params.latency)
        input.turn_detection = {
          type: "server_vad",
          threshold: vad.threshold,
          prefix_padding_ms: vad.prefix_padding_ms,
          silence_duration_ms: vad.silence_duration_ms,
        }
      }
      if (params.noiseReduction !== "off") {
        input.noise_reduction = { type: params.noiseReduction }
      }

      ws.send(
        JSON.stringify({
          type: "session.update",
          session: { type: "transcription", audio: { input } },
        })
      )
      this.setStatus("listening")
    }

    ws.onmessage = (ev) => {
      if (!this.running) return
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      this.handleEvent(msg)
    }

    ws.onerror = () => {
      if (!this.running) return
      this.fail("Transcription connection error.")
    }

    ws.onclose = (ev) => {
      if (!this.running) return
      if (ev.code !== 1000) {
        this.fail(`Connection closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ""}).`)
      }
    }
  }

  private handleEvent(msg: Record<string, unknown>) {
    const type = String(msg.type ?? "")
    switch (type) {
      case "conversation.item.input_audio_transcription.delta": {
        const delta = typeof msg.delta === "string" ? msg.delta : ""
        if (!delta) return
        if (this.partialId === null) this.partialId = ++this.seq
        this.partialText += delta
        this.emit()
        return
      }
      case "conversation.item.input_audio_transcription.completed": {
        const transcript =
          typeof msg.transcript === "string" ? msg.transcript : this.partialText
        const text = transcript.trim()
        if (text) {
          this.finals.push({ id: this.partialId ?? ++this.seq, text })
          if (this.finals.length > MAX_LINES) {
            this.finals = this.finals.slice(-MAX_LINES)
          }
        }
        this.partialId = null
        this.partialText = ""
        this.emit()
        return
      }
      case "input_audio_buffer.speech_started": {
        // Fresh utterance beginning (server VAD) — open a new partial
        // line so the previous final scrolls up.
        if (this.partialId === null) this.partialId = ++this.seq
        this.partialText = ""
        this.emit()
        return
      }
      case "error": {
        const err = msg.error as { message?: string } | undefined
        this.fail(err?.message ? `OpenAI: ${err.message}` : "Transcription error.")
        return
      }
      default:
        return
    }
  }

  private currentLines(): TranscriptionLine[] {
    const lines = [...this.finals]
    if (this.partialId !== null && this.partialText.trim()) {
      lines.push({ id: this.partialId, text: this.partialText })
    }
    return lines.slice(-MAX_LINES)
  }

  // emit is throttled (trailing) for transcript updates so a burst of
  // deltas can't saturate the event bus or the render loop.
  private emit() {
    const MIN_MS = 120
    const now = Date.now()
    const elapsed = now - this.lastEmitTs
    if (elapsed >= MIN_MS) {
      this.flush()
      return
    }
    if (this.emitTimer === null) {
      this.emitTimer = window.setTimeout(() => {
        this.emitTimer = null
        this.flush()
      }, MIN_MS - elapsed)
    }
  }

  private flush() {
    if (this.emitTimer !== null) {
      window.clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    this.lastEmitTs = Date.now()
    this.listener({
      gen: this.gen,
      status: this.status,
      lines: this.currentLines(),
      error: this.error,
    })
  }

  // Status transitions bypass the throttle so connect/listen/error
  // states update immediately.
  private setStatus(status: TranscriptionStatus) {
    this.status = status
    if (status !== "error") this.error = undefined
    this.flush()
  }

  private fail(message: string) {
    this.error = message
    this.status = "error"
    this.flush()
  }
}

// floatToPcm16 downsamples (linear) from inRate to outRate when they
// differ and converts the [-1,1] floats to little-endian Int16.
function floatToPcm16(
  input: Float32Array,
  inRate: number,
  outRate: number
): Int16Array {
  let samples: Float32Array
  if (inRate === outRate) {
    samples = input
  } else {
    const ratio = inRate / outRate
    const outLen = Math.floor(input.length / ratio)
    samples = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) {
      const srcPos = i * ratio
      const i0 = Math.floor(srcPos)
      const i1 = Math.min(i0 + 1, input.length - 1)
      const frac = srcPos - i0
      samples[i] = input[i0] * (1 - frac) + input[i1] * frac
    }
  }
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

// base64FromBytes encodes in chunks to dodge call-stack limits on the
// spread used by String.fromCharCode for large buffers.
function base64FromBytes(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    )
  }
  return btoa(binary)
}
