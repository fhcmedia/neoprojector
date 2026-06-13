import { useMemo } from "react"
import { GradflowGL } from "@/features/backgrounds/engines/gradflow-gl"
import type { BackgroundSnapshot } from "@/bindings/neoprojector/services/displays"

// BackgroundView renders one resolved background snapshot full-bleed.
// Single component shared by output windows, the operator preview
// tiles, and (later) the library tab + background editor — so every
// surface shows pixel-identical backgrounds.
//
// Engine dispatch: "gradflow" parses config_json as a gradflow
// GradientConfigInput. Unknown engines and corrupt config render
// black — never throw; a bad row must not take an output window down
// mid-service.
export function BackgroundView({
  background,
  className,
}: {
  background: BackgroundSnapshot
  className?: string
}) {
  const config = useMemo(() => {
    if (background.engine !== "gradflow") return null
    try {
      const parsed = JSON.parse(background.config_json || "{}")
      return typeof parsed === "object" && parsed !== null ? parsed : null
    } catch {
      return null
    }
  }, [background.engine, background.config_json])

  if (!config) {
    return (
      <div
        className={className}
        style={{ position: "absolute", inset: 0, background: "#000" }}
      />
    )
  }

  return (
    <div className={className} style={{ position: "absolute", inset: 0 }}>
      <GradflowGL config={config} />
    </div>
  )
}
