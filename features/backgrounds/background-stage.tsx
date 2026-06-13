import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react"
import { mountGradflow, type GradflowConfig } from "./engines/gradflow-gl"
import type { BackgroundSnapshot } from "@/bindings/neoprojector/services/displays"

// One hidden GradFlow canvas drives every preview tile in the main window.
// Tiles read it through this context and blit with drawImage — no per-tile
// WebGL context. null when there is no resolvable background (mirrors then
// render black). See docs/superpowers/specs/2026-06-12-background-sync-design.md.
const BackgroundSourceContext = createContext<{
  current: HTMLCanvasElement | null
}>({ current: null })

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
  const sourceRef = useRef<{ current: HTMLCanvasElement | null }>({
    current: null,
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
    const canvas = canvasRef.current
    if (!canvas || !cfgRef.current) {
      sourceRef.current.current = null
      return
    }
    sourceRef.current.current = canvas
    const handle = mountGradflow(
      canvas,
      () => cfgRef.current as GradflowConfig,
      { preserveDrawingBuffer: true },
    )
    return () => {
      handle.destroy()
      sourceRef.current.current = null
    }
    // Remount only on background-content change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <BackgroundSourceContext.Provider value={sourceRef.current}>
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
export function BackgroundMirror({ className }: { className?: string }) {
  const source = useContext(BackgroundSourceContext)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    let raf = 0
    const draw = () => {
      const src = source.current
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      if (canvas.width !== w) canvas.width = w
      if (canvas.height !== h) canvas.height = h
      if (src && src.width > 0 && src.height > 0) {
        ctx.drawImage(src, 0, 0, w, h)
      } else {
        ctx.fillStyle = "#000"
        ctx.fillRect(0, 0, w, h)
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [source])

  return (
    <canvas
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
