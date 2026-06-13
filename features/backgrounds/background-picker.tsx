import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/popover"
import { cn } from "@/lib/utils"
import { useBackgrounds } from "./api"
import { BackgroundView } from "./background-view"
import type { BackgroundDoc } from "./presets"

// BackgroundPicker: the one assignment surface for backgrounds, used
// at every level of the chain (service default, section override,
// item override). Controlled popover so callers can pin their hover
// affordances open while it's up. Thumbnails are live BackgroundView
// renders — N small WebGL canvases exist only while the popover is
// open, so the cost is bounded and brief.
export function BackgroundPicker({
  value,
  inheritLabel,
  onPick,
  open,
  onOpenChange,
  align = "start",
  children,
}: {
  // Currently assigned background id; 0 = unset (inherit / none).
  value: number
  // What clearing means at this level: "None" for the service default,
  // "Inherit" for section/item overrides.
  inheritLabel: string
  onPick: (id: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  align?: "start" | "center" | "end"
  children: React.ReactNode
}) {
  const { data: backgrounds } = useBackgrounds()

  function pick(id: number) {
    onPick(id)
    onOpenChange(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} sideOffset={6} className="w-[260px] rounded-none p-1">
        <button
          type="button"
          onClick={() => pick(0)}
          className={cn(
            "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
            value === 0 ? "text-foreground" : "text-muted-foreground"
          )}
        >
          <span className="grid h-9 w-16 shrink-0 place-items-center border border-border/40 bg-black text-[9px] uppercase tracking-wider text-muted-foreground/60">
            off
          </span>
          <span className="truncate">{inheritLabel}</span>
        </button>
        <div className="my-1 h-px bg-border/40" />
        {(backgrounds ?? []).map((b: BackgroundDoc) => {
          const active = b.id === value
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => pick(b.id)}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                active ? "text-foreground" : "text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "relative h-9 w-16 shrink-0 overflow-hidden border",
                  active ? "border-foreground/70" : "border-border/40"
                )}
              >
                <BackgroundView
                  background={{
                    background_id: b.id,
                    engine: b.engine,
                    config_json: b.config_json,
                  }}
                />
              </span>
              <span className="truncate">{b.name}</span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}
