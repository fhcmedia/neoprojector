import { useEffect, useLayoutEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowRightIcon, CheckIcon, XIcon } from "lucide-react"

// Walkthrough is a guided coachmark tour over the workspace shell. It
// finds each step's target element by `data-tour-id` and renders a
// spotlight (clip-path cutout in a dim backdrop) plus a tooltip card
// next to it. Steps without a target render as a centred welcome /
// goodbye card so we don't have to attach IDs to every "informational"
// moment.
//
// Persistence is localStorage-only and per-device:
//   `np.walkthrough.completed=true` → suppress on every future launch
//   `np.walkthrough.requested=true` → re-run on next workspace mount
// The onboarding panel writes `requested` based on the user's checkbox;
// the workspace consumer reads + clears it on mount. Skipping or
// completing flips `completed` and clears `requested` so the user
// isn't pestered again.

const STORAGE_COMPLETED = "np.walkthrough.completed"
const STORAGE_REQUESTED = "np.walkthrough.requested"

export type WalkthroughStep = {
  /** DOM lookup key (`[data-tour-id="..."]`). Omit for a centred card. */
  targetId?: string
  title: string
  body: string
  /** Placement hint when target is set. Falls back to "bottom". */
  placement?: "top" | "bottom" | "left" | "right"
}

const DEFAULT_STEPS: WalkthroughStep[] = [
  {
    title: "Welcome to your workspace",
    body:
      "Quick tour of where things live. Hit Skip any time — you can re-open this from Settings.",
  },
  {
    targetId: "brand",
    title: "Your branding",
    body:
      "Your organisation name and logo live up here. Change them from Settings → Branding.",
    placement: "bottom",
  },
  {
    targetId: "account",
    title: "Account",
    body:
      "Account menu, sign out, and your plan status. You can also reach Settings from the cog icon.",
    placement: "bottom",
  },
  {
    targetId: "presenter",
    title: "Presenter view",
    body:
      "Open a separate operator window with current + next slide previews and on-screen controls.",
    placement: "bottom",
  },
  {
    targetId: "settings",
    title: "Settings",
    body:
      "Branding, output configuration, bibles, hotkeys — everything that's not slide-by-slide lives here.",
    placement: "bottom",
  },
  {
    targetId: "golive",
    title: "Go live",
    body:
      "Toggle output windows on every bound display. Red when live; the same button stops the broadcast.",
    placement: "bottom",
  },
  {
    title: "That's the tour",
    body:
      "From the home screen, pick a library item (templates, songs, bibles, media) to start filling slides.",
  },
]

export function isWalkthroughRequested(): boolean {
  try {
    return localStorage.getItem(STORAGE_REQUESTED) === "true"
  } catch {
    return false
  }
}

export function setWalkthroughRequested(v: boolean): void {
  try {
    if (v) localStorage.setItem(STORAGE_REQUESTED, "true")
    else localStorage.removeItem(STORAGE_REQUESTED)
  } catch {
    /* private mode etc — non-fatal */
  }
}

export function isWalkthroughCompleted(): boolean {
  try {
    return localStorage.getItem(STORAGE_COMPLETED) === "true"
  } catch {
    return false
  }
}

function markCompleted() {
  try {
    localStorage.setItem(STORAGE_COMPLETED, "true")
    localStorage.removeItem(STORAGE_REQUESTED)
  } catch {
    /* noop */
  }
}

type Props = {
  steps?: WalkthroughStep[]
  onClose: () => void
}

export function Walkthrough({ steps = DEFAULT_STEPS, onClose }: Props) {
  const [index, setIndex] = useState(0)
  // Track navigation direction so step-card enter/exit animates the right
  // way (forward = slide left out / new step in from right; back = mirror).
  const [direction, setDirection] = useState<1 | -1>(1)
  const step = steps[index]
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [viewport, setViewport] = useState({
    w: typeof window !== "undefined" ? window.innerWidth : 1280,
    h: typeof window !== "undefined" ? window.innerHeight : 800,
  })
  // Drive the whole overlay's enter/exit. We flip this to false right
  // before notifying the parent so the backdrop + spotlight fade together
  // rather than blinking away the instant the parent unmounts us.
  const [open, setOpen] = useState(true)

  // Re-measure target whenever the step changes OR the window resizes.
  // We poll for up to a second so steps that target lazy-mounted DOM
  // (e.g. dropdown triggers that appear after a click elsewhere) get
  // picked up without complex retry logic.
  useLayoutEffect(() => {
    if (!step?.targetId) {
      setRect(null)
      return
    }
    let cancelled = false
    let attempts = 0
    const tick = () => {
      if (cancelled) return
      const el = document.querySelector(
        `[data-tour-id="${CSS.escape(step.targetId!)}"]`
      ) as HTMLElement | null
      if (el) {
        setRect(el.getBoundingClientRect())
        return
      }
      if (attempts++ < 20) window.setTimeout(tick, 50)
      else setRect(null)
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [step, index])

  useEffect(() => {
    function onResize() {
      setViewport({ w: window.innerWidth, h: window.innerHeight })
      if (step?.targetId) {
        const el = document.querySelector(
          `[data-tour-id="${CSS.escape(step.targetId)}"]`
        ) as HTMLElement | null
        if (el) setRect(el.getBoundingClientRect())
      }
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [step])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close(false)
      else if (e.key === "Enter" || e.key === "ArrowRight") advance()
      else if (e.key === "ArrowLeft" && index > 0) {
        setDirection(-1)
        setIndex((i) => i - 1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step])

  function advance() {
    if (index >= steps.length - 1) close(true)
    else {
      setDirection(1)
      setIndex((i) => i + 1)
    }
  }

  function close(completed: boolean) {
    if (completed) markCompleted()
    else setWalkthroughRequested(false)
    // Let the overlay's exit animation play before tearing down. The
    // matching <AnimatePresence> below has a ~260ms exit duration; we
    // notify the parent slightly after so the fade is fully off-screen.
    setOpen(false)
    window.setTimeout(onClose, 280)
  }

  // Spotlight = full-screen dim with a hole cut where the target sits.
  // SVG mask handles the cutout cleanly across rectangles, including
  // ones near the viewport edges.
  const padding = 8
  const spotlight = useMemo(() => {
    if (!rect) return null
    return {
      x: Math.max(0, rect.left - padding),
      y: Math.max(0, rect.top - padding),
      w: rect.width + padding * 2,
      h: rect.height + padding * 2,
    }
  }, [rect])

  // Card placement: prefer the requested side; if the card would clip
  // off-screen, mirror to the opposite side. Without a target, render
  // dead-centre.
  const cardSize = { w: 360, h: 200 }
  const cardPos = useMemo(() => {
    if (!spotlight) {
      return {
        left: viewport.w / 2 - cardSize.w / 2,
        top: viewport.h / 2 - cardSize.h / 2,
      }
    }
    const placement = step?.placement ?? "bottom"
    const margin = 12
    const candidates: Record<string, { left: number; top: number }> = {
      bottom: {
        left: clamp(
          spotlight.x + spotlight.w / 2 - cardSize.w / 2,
          margin,
          viewport.w - cardSize.w - margin
        ),
        top: spotlight.y + spotlight.h + margin,
      },
      top: {
        left: clamp(
          spotlight.x + spotlight.w / 2 - cardSize.w / 2,
          margin,
          viewport.w - cardSize.w - margin
        ),
        top: spotlight.y - cardSize.h - margin,
      },
      right: {
        left: spotlight.x + spotlight.w + margin,
        top: clamp(
          spotlight.y + spotlight.h / 2 - cardSize.h / 2,
          margin,
          viewport.h - cardSize.h - margin
        ),
      },
      left: {
        left: spotlight.x - cardSize.w - margin,
        top: clamp(
          spotlight.y + spotlight.h / 2 - cardSize.h / 2,
          margin,
          viewport.h - cardSize.h - margin
        ),
      },
    }
    let pos = candidates[placement]
    // Off-screen guard: mirror if necessary.
    if (pos.top + cardSize.h > viewport.h - margin) pos = candidates.top
    if (pos.top < margin) pos = candidates.bottom
    if (pos.left + cardSize.w > viewport.w - margin) pos = candidates.left
    if (pos.left < margin) pos = candidates.right
    return pos
  }, [spotlight, step, viewport])

  if (!step) return null

  const progress = (index + 1) / steps.length

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="walkthrough-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[9999] pointer-events-none"
        >
          {/* Dim backdrop + cutout. The SVG fills the viewport; the
              rectangle inside is the "hole" the cutout punches. The
              backdrop swallows clicks (pointer-events-auto) so the user
              can't accidentally edit the workspace behind it. */}
          <svg
            width={viewport.w}
            height={viewport.h}
            className="pointer-events-auto absolute inset-0"
            onClick={(e) => {
              // Click outside the spotlight closes the tour gracefully.
              if (e.target === e.currentTarget) close(false)
            }}
          >
            <defs>
              <mask id="walkthrough-spotlight">
                <rect width="100%" height="100%" fill="white" />
                {spotlight && (
                  <motion.rect
                    initial={false}
                    animate={{
                      x: spotlight.x,
                      y: spotlight.y,
                      width: spotlight.w,
                      height: spotlight.h,
                    }}
                    transition={{ type: "spring", stiffness: 220, damping: 28, mass: 0.8 }}
                    rx={12}
                    ry={12}
                    fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.62)"
              mask="url(#walkthrough-spotlight)"
            />
          </svg>

          {/* Pulse ring around the spotlight to draw the eye. The outer
              ring breathes via a continuous keyframe instead of Tailwind's
              uniform pulse — gives the cutout a softer, more deliberate
              attention beat. */}
          {spotlight && (
            <motion.div
              initial={false}
              animate={{
                left: spotlight.x,
                top: spotlight.y,
                width: spotlight.w,
                height: spotlight.h,
              }}
              transition={{ type: "spring", stiffness: 220, damping: 28, mass: 0.8 }}
              className="pointer-events-none absolute rounded-[12px] ring-2 ring-white/80"
            >
              <motion.span
                key={`pulse-${index}`}
                initial={{ opacity: 0.55, scale: 1 }}
                animate={{ opacity: [0.55, 0.15, 0.55], scale: [1, 1.06, 1] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                className="absolute -inset-1 rounded-[14px] ring-2 ring-white/35"
              />
            </motion.div>
          )}

          {/* Tooltip card */}
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={index}
              custom={direction}
              initial={(d: 1 | -1) => ({ opacity: 0, x: d * 28, scale: 0.96 })}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={(d: 1 | -1) => ({ opacity: 0, x: -d * 24, scale: 0.97 })}
              transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.7 }}
              style={{
                left: cardPos.left,
                top: cardPos.top,
                width: cardSize.w,
              }}
              className="pointer-events-auto absolute rounded-2xl border border-white/15 bg-black/85 p-4 text-white shadow-2xl backdrop-blur-xl"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-widest text-white/40">
                    Step {index + 1} of {steps.length}
                  </span>
                  <AnimatePresence mode="wait" custom={direction}>
                    <motion.h3
                      key={`title-${index}`}
                      custom={direction}
                      initial={(d: 1 | -1) => ({ opacity: 0, y: d * 6 })}
                      animate={{ opacity: 1, y: 0 }}
                      exit={(d: 1 | -1) => ({ opacity: 0, y: -d * 4 })}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="text-base font-semibold tracking-tight"
                    >
                      {step.title}
                    </motion.h3>
                  </AnimatePresence>
                </div>
                <button
                  type="button"
                  onClick={() => close(false)}
                  aria-label="Skip tour"
                  className="grid size-6 place-items-center rounded-full text-white/50 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>

              <AnimatePresence mode="wait" custom={direction}>
                <motion.p
                  key={`body-${index}`}
                  custom={direction}
                  initial={(d: 1 | -1) => ({ opacity: 0, y: d * 6 })}
                  animate={{ opacity: 1, y: 0 }}
                  exit={(d: 1 | -1) => ({ opacity: 0, y: -d * 4 })}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1], delay: 0.04 }}
                  className="mt-2 text-sm text-white/70"
                >
                  {step.body}
                </motion.p>
              </AnimatePresence>

              {/* Progress bar — smooth fill instead of bare numeric label. */}
              <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/10">
                <motion.div
                  initial={false}
                  animate={{ width: `${progress * 100}%` }}
                  transition={{ type: "spring", stiffness: 220, damping: 30 }}
                  className="h-full rounded-full bg-gradient-to-r from-white/70 to-white"
                />
              </div>

              {/* Progress dots — clickable + animated active indicator. */}
              <div className="mt-3 flex items-center justify-center gap-1.5">
                {steps.map((_, i) => {
                  const active = i === index
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setDirection(i > index ? 1 : -1)
                        setIndex(i)
                      }}
                      aria-label={`Jump to step ${i + 1}`}
                      className="relative grid h-2 place-items-center"
                    >
                      <motion.span
                        animate={{
                          width: active ? 18 : 6,
                          opacity: active ? 1 : i < index ? 0.6 : 0.3,
                        }}
                        transition={{ type: "spring", stiffness: 320, damping: 28 }}
                        className="block h-1.5 rounded-full bg-white"
                      />
                    </button>
                  )
                })}
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => close(false)}
                  className="text-xs text-white/45 transition-colors hover:text-white/70"
                >
                  Skip tour
                </button>
                <div className="flex items-center gap-1.5">
                  <AnimatePresence initial={false}>
                    {index > 0 && (
                      <motion.button
                        key="back"
                        type="button"
                        onClick={() => {
                          setDirection(-1)
                          setIndex((i) => i - 1)
                        }}
                        initial={{ opacity: 0, x: -8, width: 0 }}
                        animate={{ opacity: 1, x: 0, width: "auto" }}
                        exit={{ opacity: 0, x: -8, width: 0 }}
                        transition={{ duration: 0.18 }}
                        className="overflow-hidden whitespace-nowrap rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-white/75 transition-colors hover:border-white/30 hover:text-white"
                      >
                        Back
                      </motion.button>
                    )}
                  </AnimatePresence>
                  <motion.button
                    type="button"
                    onClick={advance}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black shadow-[0_0_18px_rgba(255,255,255,0.18)] transition-shadow hover:bg-white/95 hover:shadow-[0_0_26px_rgba(255,255,255,0.32)]"
                  >
                    {index >= steps.length - 1 ? (
                      <>
                        <CheckIcon className="size-3.5" />
                        Done
                      </>
                    ) : (
                      <>
                        Next
                        <ArrowRightIcon className="size-3.5" />
                      </>
                    )}
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}
