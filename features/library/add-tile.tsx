import { PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// AddTile is the dashed "+" tile that ends every library grid (media,
// templates, overlays). One shared component so every tab uses the
// same outer structure — aspect-video preview area + label strip
// underneath — which matches the height of a real tile so the grid
// doesn't go ragged. If you need a more complex action surface
// (e.g. a dropdown of kinds), wrap this inside your trigger with
// `asChild` and reuse the visual shell only.
//
// The `sublabel` slot mirrors the second line that template /
// overlay tiles use under their name. Tabs whose tiles only have a
// single label line (media) can omit it — the height still lines
// up because the dashed border is consistent everywhere.
//
// Every other button prop (and ref) is forwarded to the <button>:
// an `asChild` trigger injects its own ref, onPointerDown, aria-* and
// data-state props, and Radix dropdowns open on pointerdown — dropping
// them is what made "Add overlay" / "Add template" do nothing.
export function AddTile({
  label,
  sublabel,
  busyLabel,
  busy,
  disabled,
  className,
  ...props
}: Omit<React.ComponentProps<"button">, "children"> & {
  label: string
  sublabel?: string
  busyLabel?: string
  busy?: boolean
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      className={cn(
        "group flex flex-col overflow-hidden rounded border border-dashed border-border/50 bg-background text-muted-foreground/40 transition-colors hover:border-border hover:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      <div className="grid aspect-video w-full place-items-center">
        <PlusIcon className="size-5" />
      </div>
      <div className="flex flex-col gap-0.5 border-t border-dashed border-border/40 px-2 py-1.5">
        <span className="truncate text-[11px] font-medium">
          {busy ? busyLabel ?? label : label}
        </span>
        {sublabel && (
          <span className="truncate text-[9px] uppercase tracking-wider">
            {sublabel}
          </span>
        )}
      </div>
    </button>
  )
}
