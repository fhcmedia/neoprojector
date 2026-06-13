import { useEffect, useState } from "react"
import { motion } from "motion/react"
import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router"
import {
  ArrowUpIcon,
  PanelsTopLeftIcon,
  SettingsIcon,
} from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/alert-dialog"
import {
  useLiveOutput,
  useStartLive,
  useStopLive,
} from "@/features/displays/api"
import { useIsMutating } from "@tanstack/react-query"
import { useLive } from "@/features/live/live-context"
import { useKeybinds } from "@/hooks/use-keybinds"
import { CommandPalette } from "@/features/command-palette/command-palette"
import logo from "@/assets/logo.png"

export const Route = createFileRoute("/_app")({
  component: AppShell,
})

function AppShell() {
  // Surfaces replaced the settings/editor routes — the shell detects
  // an open surface from the "/" route's search params (the shell
  // itself has no route params).
  const surface = useRouterState({
    select: (s) => (s.location.search as { surface?: string }).surface,
  })
  const surfaceOpen = surface !== undefined
  // live mirrors the Go-side IsLive (polled). The local mutation
  // invalidates it on success, so the button reflects actual window
  // state — including external close (monitor unplug, user Cmd-Q on
  // the output window).
  const { data: live = false } = useLiveOutput()
  const startMut = useStartLive()
  const stopMut = useStopLive()
  const { republish } = useLive()
  useKeybinds()
  // Debounce the "Saving" indicator. Fast optimistic mutations — e.g.
  // toggling a display's routing or power from the preview pane — trip
  // useIsMutating for only a few dozen ms, which flashed the amber
  // pill on and off (the flicker in the top toolbar). Only show it once
  // a mutation has actually been in flight past the threshold; genuine
  // saves (template edits, etc.) outlast it, instant toggles never do.
  const mutating = useIsMutating() > 0
  const [isSaving, setIsSaving] = useState(false)
  useEffect(() => {
    if (!mutating) {
      setIsSaving(false)
      return
    }
    const t = window.setTimeout(() => setIsSaving(true), 400)
    return () => window.clearTimeout(t)
  }, [mutating])
  const [confirmOffline, setConfirmOffline] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="flex h-screen flex-col bg-background text-foreground"
    >
      <header className="flex h-12 shrink-0 items-stretch justify-between border-b border-border/50">
        <Link
          to="/"
          className="flex items-stretch outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="grid w-12 place-items-center">
            <img src={logo} alt="" className="h-10 w-10" />
          </span>
          <span className="w-px bg-border/60" />
          <span className="grid place-items-center px-4 text-sm font-medium tracking-tight">
            Fathers House Church Media
          </span>
        </Link>
        <div className="flex items-stretch">
          <Link
            to="/"
            search={(prev) =>
              surfaceOpen
                ? { ...prev, surface: undefined, editId: undefined }
                : { ...prev, surface: "settings" }
            }
            aria-label={surfaceOpen ? "Back to projector" : "Settings"}
            className="grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {surfaceOpen ? (
              <PanelsTopLeftIcon className="h-4 w-4" />
            ) : (
              <SettingsIcon className="h-4 w-4" />
            )}
          </Link>
          {isSaving && (
            <span
              title="Saving…"
              className="flex items-center gap-1.5 px-2 text-[10px] text-muted-foreground/60"
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              Saving
            </span>
          )}
          <span className="w-px bg-border/60" />
          <button
            type="button"
            aria-label={live ? "Stop live" : "Go live"}
            disabled={startMut.isPending || stopMut.isPending}
            onClick={() => {
              if (live) setConfirmOffline(true)
              else
                startMut.mutate(undefined, {
                  onError: (e) =>
                    setStartError(
                      e instanceof Error ? e.message : String(e)
                    ),
                  onSuccess: () => {
                    // Re-push the current LiveProvider snapshot so
                    // the just-opened output windows pick up
                    // whatever was last live. Two pushes (immediate
                    // for the CurrentLive fetch race, delayed for
                    // the event subscription race) cover both code
                    // paths without further plumbing.
                    republish()
                    window.setTimeout(republish, 400)
                  },
                })
            }}
            className={
              "grid w-12 place-items-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50 " +
              (live
                ? "bg-red-600 text-white hover:bg-red-500"
                : "text-muted-foreground hover:bg-muted hover:text-foreground")
            }
          >
            <ArrowUpIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <AlertDialog open={confirmOffline} onOpenChange={setConfirmOffline}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop live output?</AlertDialogTitle>
            <AlertDialogDescription>
              Outputs will go dark immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                stopMut.mutate()
                setConfirmOffline(false)
              }}
            >
              Go offline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!startError}
        onOpenChange={(o) => !o && setStartError(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Can't go live</AlertDialogTitle>
            <AlertDialogDescription>
              {startError ?? ""} Open Settings → Display to enable a display
              and bind it to a connected monitor. Or enable the bypass in
              Settings → Output to go live without displays.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setStartError(null)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </motion.div>
  )
}
