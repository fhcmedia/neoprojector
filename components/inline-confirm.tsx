import { CheckIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// InlineConfirm: in-place confirmation strip used instead of a centered
// AlertDialog. Slots into a row's position so the confirmation stays
// where the user is acting.
export function InlineConfirm({
  message,
  onCancel,
  onConfirm,
  className,
}: {
  message: string
  onCancel: () => void
  onConfirm: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-1 border-b border-border/40 bg-destructive/10 px-3 py-1.5 text-xs",
        className
      )}
    >
      <span className="flex-1 truncate text-foreground/80">{message}</span>
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
        className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Confirm delete"
        onClick={onConfirm}
        className="grid size-5 place-items-center rounded bg-destructive/20 text-destructive hover:bg-destructive/30"
      >
        <CheckIcon className="size-3.5" />
      </button>
    </div>
  )
}
