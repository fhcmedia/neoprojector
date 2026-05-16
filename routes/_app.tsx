import { useState } from "react"
import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router"
import {
  ArrowUpIcon,
  BellIcon,
  CircleUserIcon,
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
import { useLive } from "@/features/live/live-context"
import { useKeybinds } from "@/hooks/use-keybinds"
import logo from "@/assets/logo.png"

export const Route = createFileRoute("/_app")({
  component: AppShell,
})

function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const inSettings = path.startsWith("/settings")
  // live mirrors the Go-side IsLive (polled). The local mutation
  // invalidates it on success, so the button reflects actual window
  // state — including external close (monitor unplug, user Cmd-Q on
  // the output window).
  const { data: live = false } = useLiveOutput()
  const startMut = useStartLive()
  const stopMut = useStopLive()
  const { republish } = useLive()
  useKeybinds()
  const [confirmOffline, setConfirmOffline] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [hasUnread, setHasUnread] = useState(false)

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
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
          <button
            type="button"
            aria-label="Account"
            className="grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <CircleUserIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={
              hasUnread ? "Notifications (unread)" : "Notifications"
            }
            onClick={() => setHasUnread((v) => !v)}
            className="relative grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <BellIcon className="h-4 w-4" />
            {hasUnread && (
              <span className="absolute right-3.5 top-3 h-1.5 w-1.5 rounded-full bg-red-500" />
            )}
          </button>
          <Link
            to={inSettings ? "/" : "/settings"}
            aria-label={inSettings ? "Back to projector" : "Settings"}
            className="grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {inSettings ? (
              <PanelsTopLeftIcon className="h-4 w-4" />
            ) : (
              <SettingsIcon className="h-4 w-4" />
            )}
          </Link>
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
              and bind it to a connected monitor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setStartError(null)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <main className="flex-1 min-h-0">
        <Outlet />
      </main>
    </div>
  )
}
