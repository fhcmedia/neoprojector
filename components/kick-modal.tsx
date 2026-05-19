import { motion, AnimatePresence } from "motion/react"
import { ShieldAlertIcon } from "lucide-react"
import { useAuth } from "@/hooks/use-auth"

// Full-screen, fully-blurred kick screen. Renders the moment an admin bans
// the device, suspends the account, or otherwise revokes access. Auto-signs
// out after a short delay (handled by use-auth) so the user can read the
// message before the UI flips back to /auth.
export function KickModal() {
  const { kick } = useAuth()
  return (
    <AnimatePresence>
      {kick && (
        <motion.div
          key="kick"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          className="fixed inset-0 z-[9999] flex items-center justify-center"
        >
          <motion.div
            initial={{ backdropFilter: "blur(0px)", backgroundColor: "rgba(0,0,0,0)" }}
            animate={{ backdropFilter: "blur(28px)", backgroundColor: "rgba(0,0,0,0.55)" }}
            exit={{ backdropFilter: "blur(0px)", backgroundColor: "rgba(0,0,0,0)" }}
            transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0"
            style={{ WebkitBackdropFilter: "blur(28px)" }}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-8 shadow-[0_20px_80px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-red-500/10 via-transparent to-rose-500/10"
            />

            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, type: "spring", stiffness: 320, damping: 18 }}
              className="relative mx-auto mb-5 grid size-14 place-items-center rounded-full bg-red-500/15 ring-1 ring-red-500/30"
            >
              <motion.span
                aria-hidden
                animate={{ scale: [1, 1.6, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                className="absolute inset-0 rounded-full ring-2 ring-red-500/40"
              />
              <ShieldAlertIcon className="size-6 text-red-300" />
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.35 }}
              className="relative text-center text-2xl font-semibold tracking-tight text-white"
            >
              Something isn't right
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32, duration: 0.35 }}
              className="relative mt-3 text-center text-sm leading-relaxed text-white/70"
            >
              {kick?.message}
            </motion.p>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.4 }}
              className="relative mt-6 flex items-center justify-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/40"
            >
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-red-400" />
              Ending session…
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
