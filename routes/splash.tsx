import { useEffect, useRef, useState } from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Events } from "@wailsio/runtime"
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
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background text-foreground gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">neoprojector</h1>

      {error ? (
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <p className="text-destructive text-sm">{error}</p>
          <button
            onClick={() => {
              setError(null)
              setStatus("Starting...")
              setProgress(0)
              initializedRef.current = false
              setAttempt((n) => n + 1)
            }}
            className="rounded-md bg-secondary hover:bg-secondary/80 px-4 py-2 text-sm"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 w-72">
          <Progress value={progress} />
          <p className="text-sm text-muted-foreground">{status}</p>
        </div>
      )}
    </div>
  )
}
