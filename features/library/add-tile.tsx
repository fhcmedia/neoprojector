import type { ButtonHTMLAttributes, Ref } from "react"
import { PlusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// AddTile is the dashed "+" tile that ends every library grid (media,
// templates, overlays). One shared component so every tab uses the
// same outer structure — aspect-video preview area + label strip
// underneath — which matches the height of a real tile so the grid
// doesn't go ragged. If you need a more complex action surface
// (e.g. a dropdown of kinds), wrap this inside your trigger with
// `asChild` and reuse the visual shell only — `ref` as a regular
// prop (React 19) plus spread of remaining button props let Radix-
// style triggers wire themselves to the underlying button
// (`onClick`, `onPointerDown`, ARIA attrs, ref). We deliberately
// avoid `forwardRef` here: @vitejs/plugin-react's Fast Refresh
// transform of `forwardRef` wrappers throws "Component is not a
// function" after HMR in this project.
//
// The `sublabel` slot mirrors the second line that template /
// overlay tiles use under their name. Tabs whose tiles only have a
// single label line (media) can omit it — the height still lines
// up because the dashed border is consistent everywhere.
type AddTileProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  sublabel?: string
  busyLabel?: string
  busy?: boolean
  ref?: Ref<HTMLButtonElement>
}

export function AddTile({
  ref,
  label,
  sublabel,
  busyLabel,
  busy,
  disabled,
  className,
  ...rest
}: AddTileProps) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || busy}
      className={cn(
        "group flex flex-col overflow-hidden rounded border border-dashed border-border/50 bg-background text-muted-foreground/40 transition-colors hover:border-border hover:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...rest}
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
