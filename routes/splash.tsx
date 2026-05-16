import { useEffect, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Events } from "@wailsio/runtime"
import { GradFlow } from "gradflow"
import { App } from "@/bindings/neoprojector"
import { Progress } from "@/components/progress"

export const Route = createFileRoute("/splash")({
  component: SplashRoute,
})

function SplashRoute() {
  const [status, setStatus] = useState("Starting...")
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const initializedRef = useRef(false)

  useEffect(() => {
    const offStatus = Events.On("splash:status", (e) => {
      setStatus(e.data as string)
    })
    const offProgress = Events.On("splash:progress", (e) => {
      setProgress(e.data as number)
    })

    if (!initializedRef.current) {
      initializedRef.current = true
      App.Initialize()
        .catch((err) => {
          setError(String(err))
        })
    }

    return () => {
      offStatus()
      offProgress()
    }
  }, [attempt])

  return (
    <div className="relative h-screen w-screen flex flex-col items-center justify-center bg-black text-white gap-6 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <GradFlow
          config={{
            color1: { r: 226, g: 98, b: 75 },
            color2: { r: 255, g: 255, b: 255 },
            color3: { r: 30, g: 34, b: 159 },
            speed: 3,
            scale: 1,
            type: "stripe",
            noise: 0.08,
          }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 rounded-2xl border border-white/10 bg-black/40 p-8 shadow-2xl backdrop-blur-xl">
        <h1 className="text-3xl font-semibold tracking-tight text-white">neoprojector</h1>

      {error ? (
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <p className="text-red-400 text-sm">{error}</p>
          <button
            onClick={() => {
              setError(null)
              setStatus("Starting...")
              setProgress(0)
              initializedRef.current = false
              setAttempt((n) => n + 1)
            }}
            className="rounded-md bg-white/10 hover:bg-white/20 px-4 py-2 text-sm text-white transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 w-72">
          <Progress value={progress} />
          <p className="text-sm text-white/70">{status}</p>
        </div>
      )}
      </div>
    </div>
  )
}
