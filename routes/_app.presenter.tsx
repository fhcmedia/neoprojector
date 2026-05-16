import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { createFileRoute } from "@tanstack/react-router"
import { RadioIcon, XIcon, ArrowRightIcon } from "lucide-react"
import { useLive } from "@/features/live/live-context"
import { ScaledTemplate } from "@/features/templates/renderer"
import { useShowTemplate } from "@/features/show/use-show-template"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_app/presenter")({
  component: PresenterView,
})

function PresenterView() {
  const { live, clearLive, navigateNext, navigatePrev, activeOverlays, clearOverlays } = useLive()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const bibleTemplate = useShowTemplate("bible")
  const songTemplate = useShowTemplate("song")

  const template =
    live?.kind === "bible"
      ? bibleTemplate
      : live?.kind === "song"
        ? songTemplate
        : undefined

  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const dateStr = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })

  return (
    <div className="flex h-full flex-col gap-0 bg-zinc-950 text-white">
      {/* Top bar */}
      <div className="flex h-10 items-center justify-between border-b border-white/10 px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
          Presenter View
        </span>
        <div className="flex items-center gap-3">
          {live ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-400">
              <RadioIcon className="size-3 animate-pulse" />
              Live
            </span>
          ) : (
            <span className="text-xs text-white/30">Nothing live</span>
          )}
        </div>
        <span className="font-mono text-xs text-white/50">{timeStr}</span>
      </div>

      <div className="flex flex-1 min-h-0 gap-4 p-4">
        {/* Current slide */}
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              Current
            </span>
            {live && (
              <button
                type="button"
                onClick={clearLive}
                className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-white/40 hover:bg-white/10 hover:text-white"
              >
                <XIcon className="size-2.5" />
                Clear
              </button>
            )}
          </div>
          <div
            className={cn(
              "relative flex-1 overflow-hidden rounded-lg border",
              live ? "border-emerald-500/40" : "border-white/10"
            )}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {template && live ? (
                <motion.div
                  key={`${live.kind}-${live.slideIndex}`}
                  initial={{ opacity: 0, y: 6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                  className="absolute inset-0"
                >
                  <ScaledTemplate
                    template={template}
                    fill={live.fill}
                    measure={false}
                    className="h-full w-full"
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="grid h-full place-items-center text-sm text-white/20"
                >
                  {live?.kind === "media" ? "Media" : "Nothing live"}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence initial={false}>
            {live && (
              <motion.div
                key="slide-info"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden rounded bg-white/5 px-2 py-1 text-[11px] text-white/50"
              >
                {live.kind} · slide {live.slideIndex + 1}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Controls column */}
        <div className="flex w-10 flex-col items-center justify-center gap-3">
          <button
            type="button"
            onClick={navigatePrev}
            className="grid size-8 place-items-center rounded border border-white/15 text-white/50 transition-colors hover:border-white/40 hover:text-white"
            title="Previous slide"
          >
            <ArrowRightIcon className="size-4 rotate-180" />
          </button>
          <button
            type="button"
            onClick={navigateNext}
            className="grid size-8 place-items-center rounded border border-white/15 text-white/50 transition-colors hover:border-white/40 hover:text-white"
            title="Next slide"
          >
            <ArrowRightIcon className="size-4" />
          </button>
        </div>

        {/* Info column */}
        <div className="flex w-56 flex-col gap-3">
          {/* Clock */}
          <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-center">
            <div className="font-mono text-3xl font-light tabular-nums text-white">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="mt-0.5 text-[11px] text-white/40">{dateStr}</div>
          </div>

          {/* Active overlays */}
          <AnimatePresence initial={false}>
            {activeOverlays.length > 0 && (
              <motion.div
                key="overlays-panel"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden rounded-lg border border-white/10 bg-white/5 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
                    Overlays ({activeOverlays.length})
                  </span>
                  <button
                    type="button"
                    onClick={clearOverlays}
                    className="text-[10px] text-white/30 underline hover:text-white"
                  >
                    Clear all
                  </button>
                </div>
                <AnimatePresence initial={false}>
                  {activeOverlays.map((o) => (
                    <motion.div
                      key={o.scheduleItemId}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="truncate rounded bg-white/5 px-2 py-1 text-[11px] text-white/60">
                        {o.name}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Keyboard hints */}
          <div className="mt-auto rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">
              Shortcuts
            </div>
            <div className="flex flex-col gap-1">
              {[
                ["← →", "Prev / Next slide"],
                ["Esc", "Clear live"],
                ["Esc ×2", "Clear overlays"],
                ["Ctrl+K", "Command palette"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-2 text-[11px]">
                  <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/60">
                    {key}
                  </kbd>
                  <span className="text-white/40">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
