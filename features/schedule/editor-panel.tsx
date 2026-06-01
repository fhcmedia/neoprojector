import { useRef, type ReactNode } from "react"
import { motion } from "motion/react"
import { cn } from "@/lib/utils"

// EditorPanel: second-layer slide-in that occupies the same column as the
// schedule sidebar. Closed = translated off-screen to the left; open = slid in.
// Always mounted so the close transition plays. Pure container — the content
// (AddFlow) owns its own header + back, so a single back arrow can step within
// the flow before closing the panel.
//
// `exitMode` picks which close animation plays the next time `open` flips
// to false: "slide" (default, for explicit back) leaves to the left;
// "fade" (for final save) keeps position and fades out.
export function EditorPanel({
  open,
  exitMode = "slide",
  onClosed,
  children,
}: {
  open: boolean
  exitMode?: "slide" | "fade"
  onClosed?: () => void
  children: ReactNode
}) {
  const wasOpenRef = useRef(false)
  const target = open
    ? { x: "0%", opacity: 1 }
    : exitMode === "fade"
      ? { x: "0%", opacity: 0 }
      : { x: "-100%", opacity: 1 }

  return (
    <motion.div
      aria-hidden={!open}
      initial={false}
      animate={target}
      transition={{
        x: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
        opacity: { duration: 0.14, ease: "easeOut" },
      }}
      onAnimationComplete={() => {
        // Only signal "closed" on the transition that took the panel from
        // open to closed — not on initial render or open-side transitions.
        if (!open && wasOpenRef.current) {
          wasOpenRef.current = false
          onClosed?.()
        }
        if (open) wasOpenRef.current = true
      }}
      className={cn(
        "absolute inset-0 z-10 flex flex-col border-r border-border/50 bg-background shadow-2xl",
        !open && "pointer-events-none"
      )}
    >
      {children}
    </motion.div>
  )
}
