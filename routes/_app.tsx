import { createContext, useContext, useState } from "react"
import { motion } from "motion/react"
import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
  redirect,
} from "@tanstack/react-router"
import {
  ArrowUpIcon,
  BellIcon,
  CircleUserIcon,
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
import logo from "@/assets/logo.png"
import { useAuth } from "@/hooks/use-auth"

export const Route = createFileRoute("/_app")({
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("neoprojector.auth")
      if (!saved) {
        throw redirect({
          to: "/auth",
          replace: true,
        })
      }
    }
  },
  component: AppShell,
})

export const LiveContext = createContext<{ 
  live: boolean; 
  setLive: (v: boolean) => void 
}>({ live: false, setLive: () => {} })

export function useLive() {
  return useContext(LiveContext)
}

function AppShell() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const inSettings = path.startsWith("/settings")
  const [live, setLive] = useState(false)
  const [confirmOffline, setConfirmOffline] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)
  const { user, logout } = useAuth()
  const navigate = Route.useNavigate()

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
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Account"
                className="grid w-12 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <CircleUserIcon className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 overflow-hidden rounded-xl border border-border/50 bg-background/95 p-0 shadow-lg backdrop-blur-md">
              <div className="flex flex-col p-4">
                <span className="text-sm font-semibold text-foreground">Welcome, {user?.username}</span>
                <span className="text-xs text-muted-foreground">Pro License Active</span>
              </div>
              <div className="h-px bg-border/50" />
              <div className="p-2">
                <button
                  type="button"
                  onClick={() => {
                    logout()
                    navigate({ to: "/auth", replace: true })
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
            onClick={() => {
              if (live) setConfirmOffline(true)
              else setLive(true)
            }}
            className={
              "grid w-12 place-items-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset " +
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
                setLive(false)
                setConfirmOffline(false)
              }}
            >
              Go offline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <main className="flex-1 min-h-0">
        <LiveContext.Provider value={{ live, setLive }}>
          <Outlet />
        </LiveContext.Provider>
      </main>
    </motion.div>
  )
}
