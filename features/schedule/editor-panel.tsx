import { type ReactNode } from "react"
import { motion } from "motion/react"
import { ArrowLeftIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// EditorPanel: second-layer slide-in that occupies the same column as the
// schedule sidebar. Closed = translated off-screen to the left; open = slid in.
// Always mounted so the close transition plays.
//
// `exitMode` picks which close animation plays the next time `open` flips
// to false: "slide" (default, for explicit back) leaves to the left;
// "fade" (for final save) keeps position and fades out.
export function EditorPanel({
  open,
  title,
  exitMode = "slide",
  onBack,
  children,
}: {
  open: boolean
  title: string
  exitMode?: "slide" | "fade"
  onBack: () => void
  children: ReactNode
}) {
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
        x: { type: "spring", stiffness: 360, damping: 36 },
        opacity: { duration: 0.22, ease: "easeOut" },
      }}
      className={cn(
        "absolute inset-0 z-10 flex flex-col border-r border-border/50 bg-background shadow-2xl",
        !open && "pointer-events-none"
      )}
    >
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
        </button>
        <span className="flex-1 truncate text-xs font-medium tracking-tight">
          {title}
        </span>
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </motion.div>
  )
}
