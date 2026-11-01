import { useEffect, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { SparklesIcon } from "lucide-react"
import * as AppService from "@/bindings/neoprojector/app"
import type { AppInfo } from "@/bindings/neoprojector/models"

// Startup notification: every launch shows which version is running;
// the first launch on a new version also lists what changed in it (the
// "What's new" list CI writes into the GitHub release). On by default,
// switchable in Settings → General.

const ENABLED_KEY = "neoprojector.startupNotice"
const LAST_VERSION_KEY = "neoprojector.lastSeenVersion"
// sessionStorage survives reloads of the operator window but not an app
// restart, so the notice shows once per launch.
const SHOWN_KEY = "neoprojector.startupNoticeShown"

function read(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(store: Storage | undefined, key: string, value: string) {
  try {
    store?.setItem(key, value)
  } catch {
    // Storage blocked: the notice just shows again next time.
  }
}

const listeners = new Set<() => void>()

function isEnabled(): boolean {
  return read(globalThis.localStorage, ENABLED_KEY) !== "false"
}

export function useStartupNoticeSetting() {
  const enabled = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    isEnabled
  )
  const setEnabled = (v: boolean) => {
    write(globalThis.localStorage, ENABLED_KEY, String(v))
    for (const l of listeners) l()
  }
  return { enabled, setEnabled }
}

// StartupNotice renders nothing; mount it once in the operator shell.
// Toasts are global, so the effect is fire-once (no cleanup): under
// StrictMode's mount→unmount→mount a cancel flag would swallow it.
export function StartupNotice() {
  useEffect(() => {
    void showStartupNotice()
  }, [])
  return null
}

let started = false

async function showStartupNotice() {
  if (started || read(globalThis.sessionStorage, SHOWN_KEY)) return
  started = true
  write(globalThis.sessionStorage, SHOWN_KEY, "1")
  try {
    const info = (await AppService.Info()) as unknown as AppInfo
    const last = read(globalThis.localStorage, LAST_VERSION_KEY)
    write(globalThis.localStorage, LAST_VERSION_KEY, info.version)
    if (!isEnabled()) return
    const label = info.version === "0.0.0-dev" ? "dev build" : `v${info.version}`
    const isNew = last !== info.version
    if (!isNew) {
      toast(`NeoProjector ${label}`, {
        description: "Up to date.",
        icon: <SparklesIcon className="size-4" />,
        duration: 4000,
      })
      return
    }
    const notes = ((await AppService.ReleaseNotes()) ?? []) as string[]
    toast(
      last ? `Updated to NeoProjector ${label}` : `NeoProjector ${label}`,
      {
        icon: <SparklesIcon className="size-4 text-sky-400" />,
        duration: notes.length ? 15000 : 6000,
        closeButton: true,
        description: notes.length ? (
          <div className="mt-1 flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              What's new
            </span>
            <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs">
              {notes.slice(0, 6).map((n) => (
                <li key={n}>{n}</li>
              ))}
              {notes.length > 6 && (
                <li className="list-none text-muted-foreground">
                  …and {notes.length - 6} more
                </li>
              )}
            </ul>
          </div>
        ) : last ? (
          "Updated automatically."
        ) : undefined,
      }
    )
  } catch {
    // Offline or a binding hiccup: no notice this launch.
  }
}
