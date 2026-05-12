import { type ReactNode } from "react"
import { ArrowLeftIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// EditorPanel: second-layer slide-in that occupies the same column as the
// schedule sidebar. Closed = translated off-screen to the left; open = slid in.
// Always mounted so the close transition plays.
export function EditorPanel({
  open,
  title,
  onBack,
  children,
}: {
  open: boolean
  title: string
  onBack: () => void
  children: ReactNode
}) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        "absolute inset-0 z-10 flex flex-col border-r border-border/50 bg-background shadow-2xl transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "-translate-x-full"
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
    </div>
  )
}
