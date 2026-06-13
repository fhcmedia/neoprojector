import { createContext, useContext, type ReactNode } from "react"
import { motion } from "motion/react"
import { variantsFor, type AnimKind } from "@/features/animations/variants"

// Per-element overlay animation. A widget marks its visual portions
// with <OverlayPart> — when the overlay instance mounts with a
// stagger configured (layout.style.stagger_ms > 0), each part runs
// the overlay's entry animation individually, offset by the stagger,
// and mirrors out in reverse order when the overlay leaves live.
//
// Without a provider (library tiles, editor canvas, stagger off),
// OverlayPart renders a plain div — widgets don't need to know which
// surface they're on. Motion's variant propagation does the lifting:
// the instance-level motion.div drives "hidden"/"visible" states and
// AnimatePresence holds the whole overlay until every part finishes
// its exit.
type PartsCtx = {
  kind: AnimKind
  durationMs: number
}

const Ctx = createContext<PartsCtx | null>(null)

export function OverlayParts({
  kind,
  durationMs,
  children,
}: PartsCtx & { children: ReactNode }) {
  return <Ctx.Provider value={{ kind, durationMs }}>{children}</Ctx.Provider>
}

export function OverlayPart({
  className,
  style,
  children,
}: {
  className?: string
  style?: React.CSSProperties
  children?: ReactNode
}) {
  const ctx = useContext(Ctx)
  if (!ctx) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    )
  }
  const v = variantsFor(ctx.kind)
  return (
    <motion.div
      className={className}
      style={style}
      variants={v.variants}
      transition={{ ...v.transition, duration: ctx.durationMs / 1000 }}
    >
      {children}
    </motion.div>
  )
}

// Parent variants for a staggered overlay instance: the container
// itself stays static (parts own the motion) and only orchestrates —
// children stagger in on entry and peel off in reverse on exit.
export function staggerContainerVariants(staggerMs: number) {
  const s = staggerMs / 1000
  return {
    hidden: {
      transition: { staggerChildren: s, staggerDirection: -1 },
    },
    visible: {
      transition: { staggerChildren: s },
    },
  }
}
