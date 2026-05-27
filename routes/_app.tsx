import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import {
  createFileRoute,
  Link,
  Navigate,
  Outlet,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router"
import {
  ArrowUpIcon,
  BellIcon,
  CircleUserIcon,
  MonitorIcon,
  PanelsTopLeftIcon,
  SettingsIcon,
  LogOutIcon,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/popover"
import {
  useLiveOutput,
  useStartLive,
  useStopLive,
} from "@/features/displays/api"
import { useIsMutating } from "@tanstack/react-query"
import { useLive } from "@/features/live/live-context"
import { LivePreviewWidget } from "@/features/live/live-preview-widget"
import { useKeybinds } from "@/hooks/use-keybinds"
import { CommandPalette } from "@/features/command-palette/command-palette"
import { useAuth } from "@/hooks/use-auth"
import { startSyncEngine } from "@/lib/library-sync"
import {
  Walkthrough,
  isWalkthroughRequested,
} from "@/features/walkthrough/walkthrough"
import logo from "@/assets/logo.png"

export const Route = createFileRoute("/_app")({
  component: AppShell,
})

function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const auth = useAuth()
  const inSettings = path.startsWith("/settings")
  const inEditor =
    path.startsWith("/templates/") || path.startsWith("/overlays/")
  // live mirrors the Go-side IsLive (polled). The local mutation
  // invalidates it on success, so the button reflects actual window
  // state — including external close (monitor unplug, user Cmd-Q on
  // the output window).
  const { data: live = false } = useLiveOutput()
  const startMut = useStartLive()
  const stopMut = useStopLive()
  const { republish } = useLive()
  useKeybinds()
  const isSaving = useIsMutating() > 0
  const [confirmOffline, setConfirmOffline] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [hasUnread, setHasUnread] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Walkthrough is gated on a localStorage flag the onboarding card
  // writes (`np.walkthrough.requested`). Captured once at mount so the
  // tour doesn't re-trigger mid-session when the user revisits this
  // route or HMR re-runs the file.
  const [tourOpen, setTourOpen] = useState(() => isWalkthroughRequested())

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

  // Cloud-library sync engine. Owns the boot-time backfill, periodic pull,
  // outbox drain, and online/visibility listeners. Returns a teardown the
  // effect runs on sign-out / unmount. Re-keyed on auth so a logout-then-
  // login cycle starts a fresh engine without stale closures.
  useEffect(() => {
    if (auth.loading || !auth.isAuthenticated) return
    const stop = startSyncEngine((s) => {
      if (s.pulled || s.pushed) {
        console.info("[library-sync]", s)
      }
    })
    return stop
  }, [auth.loading, auth.isAuthenticated])
  const { user, logout, account } = auth
  const navigate = useNavigate()

  // Auth guards run AFTER all hooks above so React's hook-count check stays
  // stable across re-renders (loading → ready transitions would otherwise
  // mismatch and throw "rendered fewer hooks than expected").
  if (auth.loading) return null
  if (!auth.isAuthenticated) {
    return <Navigate to="/auth" replace />
  }
  if (
    auth.account &&
    (auth.account.status === "trial_expired" ||
      auth.account.status === "suspended" ||
      auth.account.status === "banned" ||
      auth.account.status === "no_access")
  ) {
    return <Navigate to="/auth" search={{ reason: auth.account.status } as never} replace />
  }
  const trialMs = account?.trial && !account?.license ? account.trial.ms_remaining : null
  const trialDays = trialMs !== null ? Math.max(0, Math.ceil(trialMs / (24 * 60 * 60_000))) : null
  const planLabel = account?.license
    ? `${cap(account.license.plan)} License Active`
    : trialDays !== null
      ? `Trial — ${trialDays} day${trialDays === 1 ? "" : "s"} left`
      : "License pending"

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
          data-tour-id="brand"
          className="flex items-stretch outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="grid w-12 place-items-center overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.img
                key={auth.profile?.orgLogo ?? "default"}
                src={auth.profile?.orgLogo ?? logo}
                alt=""
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="h-10 w-10 object-contain"
              />
            </AnimatePresence>
          </span>
          <span className="w-px bg-border/60" />
          <span className="grid place-items-center px-4 text-sm font-medium tracking-tight">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={auth.profile?.orgName ?? "default"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="block max-w-[260px] truncate"
              >
                {auth.profile?.orgName ?? "Fathers House Church Media"}
              </motion.span>
            </AnimatePresence>
          </span>
        </Link>
        <div className="flex items-stretch">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Account"
                data-tour-id="account"
                className="grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <CircleUserIcon className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 overflow-hidden rounded-xl border border-border/50 bg-background/95 p-0 shadow-lg backdrop-blur-md">
              <div className="flex flex-col p-4">
                <span className="text-sm font-semibold text-foreground">
                  Welcome, {user?.email?.split("@")[0] ?? "User"}
                </span>
                <span className="text-xs text-muted-foreground">{planLabel}</span>
              </div>
              <div className="h-px bg-border/50" />
              <div className="p-2">
                <button
                  type="button"
                  onClick={() => {
                    void logout().finally(() => {
                      navigate({ to: "/auth", replace: true })
                    })
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-red-500 transition-colors hover:bg-red-500/10 focus-visible:bg-red-500/10 focus-visible:outline-none"
                >
                  <LogOutIcon className="h-4 w-4" />
                  Sign Out
                </button>
              </div>
            </PopoverContent>
          </Popover>
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
            to="/presenter"
            aria-label="Presenter view"
            data-tour-id="presenter"
            className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <MonitorIcon className="h-4 w-4" />
          </Link>
          <Link
            to={inSettings || inEditor ? "/" : "/settings"}
            aria-label={inSettings || inEditor ? "Back to projector" : "Settings"}
            data-tour-id="settings"
            className="grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {inSettings || inEditor ? (
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
            data-tour-id="golive"
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
      {/* Floating live preview only on the presentations editor —
          the schedule view already has the dedicated PREVIEW pane on
          the right, so the corner card would just duplicate it. */}
      {path.startsWith("/presentations") && <LivePreviewWidget />}
      {tourOpen && <Walkthrough onClose={() => setTourOpen(false)} />}
    </motion.div>
  )
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}
