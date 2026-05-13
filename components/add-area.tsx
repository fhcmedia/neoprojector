import { PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// AddArea: clickable empty-space affordance used across feature lists.
// Two states:
//   - hasContent === false → prompt fully visible, fills available space.
//   - hasContent === true  → prompt hidden by default, fades in on hover
//                            so the populated list isn't cluttered.
export function AddArea({
  hasContent,
  onClick,
  fullLabel,
  hoverLabel,
}: {
  hasContent: boolean
  onClick: () => void
  fullLabel: string
  hoverLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={hasContent ? hoverLabel : fullLabel}
      className={cn(
        "group flex flex-1 items-center justify-center gap-1.5 text-xs transition-colors",
        hasContent
          ? "min-h-16 text-muted-foreground/0 hover:text-muted-foreground/60"
          : "min-h-full text-muted-foreground/70 hover:text-muted-foreground"
      )}
    >
      <PlusIcon
        className={cn(
          "size-3.5 transition-opacity",
          hasContent && "opacity-0 group-hover:opacity-100"
        )}
      />
      <span
        className={cn(
          "transition-opacity",
          hasContent && "opacity-0 group-hover:opacity-100"
        )}
      >
        {hasContent ? hoverLabel : fullLabel}
      </span>
    </button>
  )
}
