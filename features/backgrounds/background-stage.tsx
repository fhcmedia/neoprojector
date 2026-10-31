import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react"
import { mountGradflow, type GradflowConfig } from "./engines/gradflow-gl"
import { BACKGROUND_FADE_MS } from "./background-crossfade"
import type { BackgroundSnapshot } from "@/bindings/neoprojector/services/displays"

// One hidden GradFlow canvas drives every preview tile in the main window.
// Tiles read it through this context and blit with drawImage — no per-tile
// WebGL context. null when there is no resolvable background (mirrors then
// render black). See docs/superpowers/specs/2026-06-12-background-sync-design.md.
//
// `version` bumps whenever the source switches to a different background
// (or to none) and `ready` flips true once that background has drawn its
// first frame. Mirrors use the pair to hold the previous picture while
// the new engine spins up and then dissolve into it, matching the output
// window's BackgroundCrossfade instead of flashing black.
type BackgroundSource = {
  current: HTMLCanvasElement | null
  version: number
  ready: boolean
}

const BackgroundSourceContext = createContext<BackgroundSource>({
  current: null,
  version: 0,
  ready: true,
})

function parseGradflow(snap: BackgroundSnapshot | null): GradflowConfig | null {
  if (!snap || snap.engine !== "gradflow") return null
  try {
    const parsed = JSON.parse(snap.config_json || "{}")
    return typeof parsed === "object" && parsed !== null
      ? (parsed as GradflowConfig)
      : null
  } catch {
    return null
  }
}

// BackgroundStage renders the resolved background once into an offscreen
// 16:9 source canvas and publishes it for mirrors. Mount it once at the
// preview pane root.
export function BackgroundStage({
  background,
  children,
}: {
  background: BackgroundSnapshot | null
  children: ReactNode
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sourceRef = useRef<{ current: BackgroundSource }>({
    current: { current: null, version: 0, ready: true },
  })

  // Content key: only remount the engine when the actual background
  // changes, not on every parent render (same guard discipline as the
  // service-background bridge).
  const config = useMemo(() => parseGradflow(background), [background])
  const key = config
    ? `${background?.engine}:${background?.config_json}`
    : "none"
  const cfgRef = useRef<GradflowConfig | null>(config)
  cfgRef.current = config

  useEffect(() => {
    const src = sourceRef.current.current
    const canvas = canvasRef.current
    src.version += 1
    if (!canvas || !cfgRef.current) {
      src.current = null
      src.ready = true
      return
    }
    src.current = canvas
    src.ready = false
    const version = src.version
    const handle = mountGradflow(
      canvas,
      () => cfgRef.current as GradflowConfig,
      {
        preserveDrawingBuffer: true,
        onFirstFrame: () => {
          if (src.version === version) src.ready = true
        },
      },
    )
    return () => {
      handle.destroy()
      src.current = null
    }
    // Remount only on background-content change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <BackgroundSourceContext.Provider value={sourceRef.current.current}>
      {/* Offscreen but laid out (NOT display:none, which would zero the
          box and break sizing). 640x360 = 16:9; mirrors scale up. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: -99999,
          top: 0,
          width: 640,
          height: 360,
          pointerEvents: "none",
        }}
      >
        {config && (
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        )}
      </div>
      {children}
    </BackgroundSourceContext.Provider>
  )
}

// BackgroundMirror paints the Stage's source canvas into a tile-sized 2D
// canvas each frame. No WebGL context; black until the source exists.
// On a background switch it freezes its last picture until the new
// source has painted, then dissolves from that picture into the new one
// over BACKGROUND_FADE_MS — the same look as the output window.
export function BackgroundMirror({ className }: { className?: string }) {
  const source = useContext(BackgroundSourceContext)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    let raf = 0
    let seenVersion = source.version
    // Frozen copy of the last frame shown before a switch, plus when the
    // dissolve out of it started (null = still waiting for the new
    // source's first frame).
    let snapshot: HTMLCanvasElement | null = null
    let fadeStart: number | null = null
    const draw = () => {
      const src = source.current
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      if (source.version !== seenVersion) {
        seenVersion = source.version
        const snap = document.createElement("canvas")
        snap.width = canvas.width
        snap.height = canvas.height
        snap.getContext("2d")?.drawImage(canvas, 0, 0)
        snapshot = snap
        fadeStart = null
      }
      if (snapshot && !source.ready) {
        // New engine still compiling: keep showing the old picture.
        ctx.drawImage(snapshot, 0, 0, w, h)
        raf = requestAnimationFrame(draw)
        return
      }
      if (src && src.width > 0 && src.height > 0) {
        ctx.drawImage(src, 0, 0, w, h)
      } else {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, w, h)
      }
      if (snapshot) {
        const now = performance.now()
        if (fadeStart === null) fadeStart = now
        const alpha = 1 - (now - fadeStart) / BACKGROUND_FADE_MS
        if (alpha > 0) {
          ctx.globalAlpha = alpha
          ctx.drawImage(snapshot, 0, 0, w, h)
          ctx.globalAlpha = 1
        } else {
          snapshot = null
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [source])

  return (
    <canvas
      // Without this ref the draw loop above found no canvas and bailed,
      // so preview tiles never showed the live background at all.
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
      }}
    />
  )
}
