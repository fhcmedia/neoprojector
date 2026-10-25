import { Checkbox } from "@/components/checkbox"
import type { OverlayRules } from "@/features/overlays/types"

// BehaviorRules: the overlay behavior toggles (cover slide, sticky,
// hide while content is on screen), shared by the library overlay
// editor and the schedule item editor so a scheduled copy can be
// adjusted the same way. Display targeting lives in ScreenPicker.
export function BehaviorRules({
  rules,
  onChange,
}: {
  rules: OverlayRules
  onChange: (next: OverlayRules) => void
}) {
  return (
    <>
      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-muted-foreground">
        <Checkbox
          checked={rules.cover_slide ?? false}
          onCheckedChange={(v) =>
            onChange({ ...rules, cover_slide: v === true })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block font-medium text-foreground">
            Cover slide content
          </span>
          <span className="block text-[10px] text-muted-foreground/70">
            While this overlay is active, hide the bible/song/media
            template underneath. Best for countdowns and pre-service
            screens that own the canvas.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-muted-foreground">
        <Checkbox
          checked={rules.sticky ?? false}
          onCheckedChange={(v) =>
            onChange({ ...rules, sticky: v === true })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block font-medium text-foreground">
            Sticky
          </span>
          <span className="block text-[10px] text-muted-foreground/70">
            Stays on screen above everything — bible verses, songs,
            presentations — and Esc won't clear it. Turn it off by
            clicking its schedule item again.
          </span>
        </span>
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-muted-foreground">
        <Checkbox
          checked={rules.hide_on_content ?? false}
          onCheckedChange={(v) =>
            onChange({ ...rules, hide_on_content: v === true })
          }
          className="mt-0.5"
        />
        <span>
          <span className="block font-medium text-foreground">
            Hide while content is on screen
          </span>
          <span className="block text-[10px] text-muted-foreground/70">
            Fades out while a verse, song, video or presentation is
            showing, and comes back when it's cleared. Timers keep
            running while hidden.
          </span>
        </span>
      </label>
    </>
  )
}
